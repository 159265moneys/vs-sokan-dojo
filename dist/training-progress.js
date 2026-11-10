import { winningMoves, winner, classify } from "./game.js";

export const TRAINING_VERSION = 1;
export const RECHECK_GAP = 3;
export const PASS_VARIANTS = 5;

const integer = (value, fallback = 0) =>
  Number.isSafeInteger(value) && value >= 0 ? value : fallback;
const key = (value) =>
  typeof value === "string" && value.length > 0 && value.length <= 1000
    ? value
    : null;
const keys = (values) =>
  Array.isArray(values) ? [...new Set(values.filter((v) => key(v)))] : [];

function emptyTheme() {
  return {
    attempts: 0,
    completions: 0,
    cleanCompletions: 0,
    hintedAttempts: 0,
    missedAttempts: 0,
    cleanVariants: [],
    separatedRechecks: 0,
    lastAnsweredAt: null,
    lastClean: false,
    needsRecheck: false,
  };
}

function hydrateTheme(raw = {}) {
  const attempts = integer(raw.attempts);
  return {
    ...emptyTheme(),
    attempts,
    completions: Math.min(attempts, integer(raw.completions)),
    cleanCompletions: Math.min(attempts, integer(raw.cleanCompletions)),
    hintedAttempts: Math.min(attempts, integer(raw.hintedAttempts)),
    missedAttempts: Math.min(attempts, integer(raw.missedAttempts)),
    cleanVariants: keys(raw.cleanVariants),
    separatedRechecks: integer(raw.separatedRechecks),
    lastAnsweredAt:
      raw.lastAnsweredAt === null ? null : integer(raw.lastAnsweredAt, null),
    lastClean: raw.lastClean === true,
    needsRecheck: raw.needsRecheck === true,
  };
}

/** Hydrate this schema only. Legacy per-theme solve counters never imply a pass. */
export function createTrainingState(raw = null) {
  const state = {
    version: TRAINING_VERSION,
    totalAnswered: 0,
    themes: {},
    session: null,
    tacticalQueue: [],
  };
  if (!raw || raw.version !== TRAINING_VERSION) return state;
  state.totalAnswered = integer(raw.totalAnswered);
  if (
    raw.themes &&
    typeof raw.themes === "object" &&
    !Array.isArray(raw.themes)
  ) {
    for (const [id, value] of Object.entries(raw.themes)) {
      if (key(id) && value && typeof value === "object")
        Object.defineProperty(state.themes, id, {
          value: hydrateTheme(value),
          enumerable: true,
          writable: true,
          configurable: true,
        });
    }
  }
  if (raw.session && Number.isInteger(raw.session.size)) {
    const size = Math.max(1, Math.min(20, raw.session.size));
    const results = Array.isArray(raw.session.results)
      ? raw.session.results
          .slice(0, size)
          .filter((r) => r && key(r.themeId) && key(r.variantId))
          .map((r) => ({
            themeId: r.themeId,
            variantId: r.variantId,
            completed: r.completed === true,
            clean: r.clean === true && r.completed === true && !r.hinted,
            hinted: r.hinted === true,
          }))
      : [];
    state.session = { size, results };
  }
  if (Array.isArray(raw.tacticalQueue)) {
    for (const item of raw.tacticalQueue) {
      const valid = tacticalItem(item);
      if (valid && !state.tacticalQueue.some((q) => q.id === valid.id))
        state.tacticalQueue.push(valid);
    }
  }
  return state;
}

function themeAt(state, id) {
  return Object.hasOwn(state.themes, id) ? state.themes[id] : emptyTheme();
}

export function getThemeStats(state, themeId) {
  const theme = themeAt(state, themeId);
  const passed =
    theme.cleanVariants.length >= PASS_VARIANTS &&
    theme.separatedRechecks > 0 &&
    !theme.needsRecheck;
  return {
    ...theme,
    cleanVariants: [...theme.cleanVariants],
    uniqueCleanVariants: theme.cleanVariants.length,
    firstTryAccuracy: theme.attempts
      ? theme.cleanCompletions / theme.attempts
      : 0,
    status: passed ? "passed" : theme.attempts ? "practiced" : "new",
    due:
      theme.lastAnsweredAt !== null &&
      state.totalAnswered - theme.lastAnsweredAt >= RECHECK_GAP &&
      !passed,
  };
}

/** Record exactly once at the end of a whole sequence, including an abandoned one. */
export function recordTrainingAttempt(state, attempt) {
  const themeId = key(attempt?.themeId),
    variantId = key(attempt?.variantId);
  if (!themeId || !variantId)
    throw new TypeError("themeId and stable variantId are required");
  const previous = themeAt(state, themeId);
  const theme = { ...previous, cleanVariants: [...previous.cleanVariants] };
  const completed = attempt.completed === true;
  const hinted = attempt.hinted === true;
  const clean =
    completed &&
    !hinted &&
    attempt.firstTry !== false &&
    integer(attempt.wrongAttempts) === 0;
  const isNewVariant = !theme.cleanVariants.includes(variantId);
  const separated =
    theme.lastAnsweredAt !== null &&
    state.totalAnswered - theme.lastAnsweredAt >= RECHECK_GAP;
  const next = {
    ...state,
    totalAnswered: state.totalAnswered + 1,
    themes: { ...state.themes },
  };
  theme.attempts++;
  if (completed) theme.completions++;
  if (hinted) theme.hintedAttempts++;
  if (clean) {
    theme.cleanCompletions++;
    if (isNewVariant) theme.cleanVariants.push(variantId);
    if (separated && isNewVariant) theme.separatedRechecks++;
    // An immediate retry can never erase a missed/assisted retrieval.
    if (separated && isNewVariant) theme.needsRecheck = false;
  } else {
    theme.missedAttempts++;
    theme.needsRecheck = true;
  }
  theme.lastClean = clean;
  theme.lastAnsweredAt = next.totalAnswered;
  Object.defineProperty(next.themes, themeId, {
    value: theme,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  if (state.session && state.session.results.length < state.session.size) {
    next.session = {
      size: state.session.size,
      results: [
        ...state.session.results,
        { themeId, variantId, completed, clean, hinted },
      ],
    };
  }
  return next;
}

/** Choose by answered-puzzle distance only. No clocks, notifications or timers. */
export function chooseNextTheme(state, themeIds) {
  const ids = keys(themeIds);
  if (!ids.length) return null;
  const scored = ids.map((id, index) => ({
    id,
    index,
    stats: getThemeStats(state, id),
  }));
  scored.sort((a, b) => {
    const priority = (s) =>
      s.due && s.needsRecheck
        ? 0
        : s.status === "new"
          ? 1
          : s.due
            ? 2
            : s.status === "passed"
              ? 4
              : 3;
    return (
      priority(a.stats) - priority(b.stats) ||
      // Where possible leave at least three answered puzzles before rechecking.
      (a.stats.lastAnsweredAt ?? -1) - (b.stats.lastAnsweredAt ?? -1) ||
      a.stats.firstTryAccuracy - b.stats.firstTryAccuracy ||
      a.stats.attempts - b.stats.attempts ||
      a.index - b.index
    );
  });
  return scored[0].id;
}

export function startTrainingSession(state, size = 5) {
  return {
    ...state,
    session: {
      size: Math.max(1, Math.min(20, integer(size, 5) || 5)),
      results: [],
    },
  };
}

export function getSessionSummary(state) {
  const session = state.session;
  if (!session) return null;
  const answered = session.results.length;
  const clean = session.results.filter((r) => r.clean).length;
  return {
    size: session.size,
    answered,
    remaining: Math.max(0, session.size - answered),
    completed: session.results.filter((r) => r.completed).length,
    clean,
    firstTryAccuracy: answered ? clean / answered : 0,
    done: answered >= session.size,
    weakThemes: [
      ...new Set(session.results.filter((r) => !r.clean).map((r) => r.themeId)),
    ],
  };
}

function tacticalItem(raw) {
  if (!raw || !key(raw.id) || !["miss-win", "miss-block"].includes(raw.kind))
    return null;
  if (
    !(Array.isArray(raw.board) || ArrayBuffer.isView(raw.board)) ||
    raw.board.length !== 225
  )
    return null;
  const cells = Array.from(raw.board);
  if (cells.some((v) => !Number.isInteger(v) || v < 0 || v > 2)) return null;
  const board = Uint8Array.from(cells);
  if (winner(board)) return null;
  const side = raw.side === 2 ? 2 : 1;
  const black = cells.filter((c) => c === 1).length,
    white = cells.filter((c) => c === 2).length;
  if (side === 1 ? black !== white : black !== white + 1) return null;
  const own = winningMoves(board, side),
    opponent = winningMoves(board, 3 - side);
  const answers =
    raw.kind === "miss-win"
      ? own
      : !own.length && opponent.length === 1
        ? opponent
        : [];
  if (!answers.length) return null;
  if (
    raw.actual !== undefined &&
    (!Number.isInteger(raw.actual) ||
      raw.actual < 0 ||
      raw.actual >= 225 ||
      board[raw.actual] ||
      classify(board, raw.actual, side).type !== raw.kind)
  )
    return null;
  return {
    id: raw.id,
    kind: raw.kind,
    board: cells,
    side,
    answers,
    ...(Number.isInteger(raw.actual) ? { actual: raw.actual } : {}),
    ...(key(raw.recordId) ? { recordId: raw.recordId } : {}),
    ...(Number.isInteger(raw.moveIndex) ? { moveIndex: raw.moveIndex } : {}),
  };
}

/** Store exact tactical misses only; answers are recomputed, never copied from an engine PV. */
export function enqueueTacticalMistake(state, mistake) {
  const item = tacticalItem(mistake);
  if (!item || state.tacticalQueue.some((q) => q.id === item.id)) return state;
  return { ...state, tacticalQueue: [...state.tacticalQueue, item] };
}

export function getTacticalMistake(state) {
  const item = state.tacticalQueue[0];
  return item
    ? { ...item, board: [...item.board], answers: [...item.answers] }
    : null;
}

export function removeTacticalMistake(state, id) {
  return {
    ...state,
    tacticalQueue: state.tacticalQueue.filter((q) => q.id !== id),
  };
}
