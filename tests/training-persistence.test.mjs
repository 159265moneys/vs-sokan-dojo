import test from "node:test";
import assert from "node:assert/strict";
import {
  createTrainingState,
  startTrainingSession,
  recordTrainingAttempt,
  getThemeStats,
  getSessionSummary,
} from "../dist/training-progress.js";
import {
  practiceSnapshot,
  restorePractice,
} from "../dist/training-persistence.js";
test("reload records a hinted partial sequence as incomplete and preserves the five-question set", () => {
  let state = startTrainingSession(createTrainingState(), 5);
  state = recordTrainingAttempt(state, {
    themeId: "five",
    variantId: "one",
    completed: true,
  });
  const result = restorePractice(
    JSON.parse(
      JSON.stringify(
        practiceSnapshot(state, {
          themeId: "chain",
          variantId: "two",
          hinted: true,
          wrongAttempts: 1,
        }),
      ),
    ),
  );
  assert.equal(result.interrupted, true);
  assert.equal(getSessionSummary(result.state).answered, 2);
  assert.equal(getSessionSummary(result.state).clean, 1);
  assert.equal(getThemeStats(result.state, "chain").cleanCompletions, 0);
  assert.equal(getThemeStats(result.state, "chain").hintedAttempts, 1);
  assert.equal(getThemeStats(result.state, "chain").needsRecheck, true);
  const again = restorePractice(practiceSnapshot(result.state));
  assert.equal(again.interrupted, false);
  assert.equal(again.state.totalAnswered, 2);
});
test("atomic completed snapshot clears active attempt and never double-counts a solved sequence", () => {
  const state = recordTrainingAttempt(
    startTrainingSession(createTrainingState()),
    { themeId: "chain", variantId: "done", completed: true, firstTry: true },
  );
  const result = restorePractice(practiceSnapshot(state, null));
  assert.equal(result.state.totalAnswered, 1);
  assert.equal(getThemeStats(result.state, "chain").cleanCompletions, 1);
});
test("invalid interruption data cannot invent a valid completed result", () => {
  const result = restorePractice({
    ...practiceSnapshot(createTrainingState()),
    activeAttempt: { completed: true, hinted: false },
  });
  assert.equal(result.state.totalAnswered, 0);
  assert.equal(result.interrupted, false);
});
