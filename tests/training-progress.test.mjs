import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../dist/game.js";
import {
  createTrainingState,
  recordTrainingAttempt,
  getThemeStats,
  chooseNextTheme,
  startTrainingSession,
  getSessionSummary,
  enqueueTacticalMistake,
  getTacticalMistake,
  removeTacticalMistake,
} from "../dist/training-progress.js";

const answer = (state, themeId, variantId, extra = {}) =>
  recordTrainingAttempt(state, {
    themeId,
    variantId,
    completed: true,
    firstTry: true,
    hinted: false,
    wrongAttempts: 0,
    ...extra,
  });
const spacing = (state) =>
  ["other1", "other2", "other3"].reduce(
    (s, id) => answer(s, id, `${id}-${s.totalAnswered}`),
    state,
  );

test("one answer, centered repetition, partial sequences and hints never pass a theme", () => {
  let state = createTrainingState();
  state = answer(state, "chain", "center");
  assert.equal(getThemeStats(state, "chain").status, "practiced");
  for (let i = 0; i < 8; i++) {
    state = spacing(state);
    state = answer(state, "chain", "center");
  }
  assert.equal(getThemeStats(state, "chain").uniqueCleanVariants, 1);
  assert.equal(getThemeStats(state, "chain").status, "practiced");
  for (let i = 0; i < 8; i++)
    state = answer(state, "hinted", `variant-${i}`, { hinted: true });
  for (let i = 0; i < 8; i++)
    state = answer(state, "partial", `variant-${i}`, { completed: false });
  assert.equal(getThemeStats(state, "hinted").cleanCompletions, 0);
  assert.equal(getThemeStats(state, "partial").cleanCompletions, 0);
});

test("pass needs five distinct clean full variants AND separated retrieval", () => {
  let state = createTrainingState();
  for (let i = 0; i < 5; i++) state = answer(state, "chain", `variant-${i}`);
  assert.equal(getThemeStats(state, "chain").status, "practiced");
  state = spacing(state);
  assert.equal(getThemeStats(state, "chain").due, true);
  state = answer(state, "chain", "variant-5");
  assert.equal(getThemeStats(state, "chain").status, "passed");
  state = answer(state, "chain", "variant-6", { wrongAttempts: 1 });
  assert.equal(getThemeStats(state, "chain").status, "practiced");
  state = answer(state, "chain", "variant-7");
  assert.equal(
    getThemeStats(state, "chain").status,
    "practiced",
    "immediate clean retry cannot erase miss",
  );
  state = spacing(state);
  state = answer(state, "chain", "variant-8");
  assert.equal(getThemeStats(state, "chain").status, "passed");
});

test("missed-theme selection waits for three intervening answers, then prioritizes it", () => {
  let state = answer(createTrainingState(), "chain", "variant-0", {
    firstTry: false,
  });
  const themes = ["chain", "other1", "other2", "other3"];
  assert.equal(chooseNextTheme(state, themes), "other1");
  state = answer(state, "other1", "a");
  state = answer(state, "other2", "b");
  assert.equal(getThemeStats(state, "chain").due, false);
  assert.equal(chooseNextTheme(state, themes), "other3");
  state = answer(state, "other3", "c");
  assert.equal(getThemeStats(state, "chain").due, true);
  assert.equal(chooseNextTheme(state, themes), "chain");
});

test("clean five-question sessions cover all nine themes before cycling clean rechecks", () => {
  const themes = Array.from({ length: 9 }, (_, i) => `theme-${i}`);
  let state = createTrainingState();
  const visited = new Set();
  for (let session = 0; session < 3; session++) {
    state = startTrainingSession(state);
    for (let question = 0; question < 5; question++) {
      const id = chooseNextTheme(state, themes);
      visited.add(id);
      state = answer(state, id, `variant-${state.totalAnswered}`);
      if (state.totalAnswered === 9)
        assert.equal(
          visited.size,
          9,
          "due clean rechecks must not starve unseen themes",
        );
    }
    assert.equal(getSessionSummary(state).done, true);
  }
  assert.equal(visited.size, 9);
  state = answer(state, "theme-0", "failed", { firstTry: false });
  state = spacing(state);
  assert.equal(
    chooseNextTheme(state, [...themes, "unseen"]),
    "theme-0",
    "due missed theme keeps priority over unseen themes",
  );
});

test("five-question sessions measure first-try unassisted complete solves, then stop accumulating", () => {
  let state = startTrainingSession(createTrainingState());
  state = answer(state, "chain", "a");
  state = answer(state, "block", "b", { hinted: true });
  state = answer(state, "five", "c", { completed: false });
  state = answer(state, "fork", "d", { wrongAttempts: 2 });
  state = answer(state, "outside", "e");
  assert.deepEqual(getSessionSummary(state), {
    size: 5,
    answered: 5,
    remaining: 0,
    completed: 4,
    clean: 2,
    firstTryAccuracy: 0.4,
    done: true,
    weakThemes: ["block", "five", "fork"],
  });
  state = answer(state, "chain", "f");
  assert.equal(getSessionSummary(state).answered, 5);
  assert.equal(getThemeStats(state, "chain").attempts, 2);
});

test("state round-trips without upgrading legacy counters, and operations are immutable", () => {
  const initial = createTrainingState();
  const state = answer(startTrainingSession(initial), "chain", "a");
  assert.equal(initial.totalAnswered, 0);
  assert.equal(initial.themes.chain, undefined);
  assert.deepEqual(
    createTrainingState(JSON.parse(JSON.stringify(state))),
    state,
  );
  assert.equal(
    getThemeStats(createTrainingState({ chain: 100 }), "chain").status,
    "new",
  );
  const stats = getThemeStats(state, "chain");
  stats.cleanVariants.push("fake");
  assert.equal(getThemeStats(state, "chain").uniqueCleanVariants, 1);
});

function position(black, white) {
  const board = new Uint8Array(225);
  black.split(" ").forEach((s) => (board[parse(s)] = 1));
  white.split(" ").forEach((s) => (board[parse(s)] = 2));
  return board;
}

test("tactical queue derives all immediate wins, deduplicates and rejects speculative engine picks", () => {
  let state = createTrainingState();
  const board = position("F8 G8 H8 I8", "A1 C1 E1 G1");
  state = enqueueTacticalMistake(state, {
    id: "game:8",
    board,
    kind: "miss-win",
    actual: parse("A2"),
    answers: [parse("E8")],
  });
  assert.deepEqual(getTacticalMistake(state).answers, [
    parse("E8"),
    parse("J8"),
  ]);
  assert.equal(
    enqueueTacticalMistake(state, {
      id: "game:9",
      board,
      kind: "engine-drop",
      answers: [parse("A2")],
    }),
    state,
  );
  assert.equal(
    enqueueTacticalMistake(state, { id: "game:8", board, kind: "miss-win" }),
    state,
  );
  assert.equal(
    enqueueTacticalMistake(state, {
      id: "invalid",
      board,
      kind: "miss-win",
      actual: parse("E8"),
    }),
    state,
  );
  const copy = getTacticalMistake(state);
  copy.board.fill(0);
  assert(state.tacticalQueue[0].board.some(Boolean));
  assert.equal(removeTacticalMistake(state, "game:8").tacticalQueue.length, 0);
});

test("block queue requires exactly one enemy win and no available own immediate win", () => {
  const initial = createTrainingState();
  const board = position("F8 A1 C1 E1", "G8 H8 I8 J8");
  const state = enqueueTacticalMistake(initial, {
    id: "block",
    board,
    kind: "miss-block",
    actual: parse("A2"),
  });
  assert.deepEqual(getTacticalMistake(state).answers, [parse("K8")]);
  const impossible = position("A1 C1 E1 G1", "G8 H8 I8 J8");
  assert.equal(
    enqueueTacticalMistake(initial, {
      id: "lost",
      board: impossible,
      kind: "miss-block",
    }),
    initial,
  );
  const invalid = Array(225).fill(0);
  invalid[0] = 257;
  assert.equal(
    enqueueTacticalMistake(initial, {
      id: "invalid",
      board: invalid,
      kind: "miss-win",
    }),
    initial,
  );
});
