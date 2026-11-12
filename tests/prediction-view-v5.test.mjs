import test from "node:test";
import assert from "node:assert/strict";
import { problems } from "../dist/curriculum.js";
import {
  createAttempt,
  answerLearningChoice,
  getLearningView,
  restoreLearningAttempt,
} from "../dist/learning.js";

for (const domain of ["conditions-negative", "counter-threat"])
  test(`${domain}: a wrong prediction displays its explanatory board without changing the game history`, () => {
    const p = problems.find(
      (p) => p.role === "assessment" && p.assessmentDomain === domain,
    );
    let state = createAttempt(p.id, { attemptId: "prediction" });
    const wrong = p.nodes[0].choices.find((c) => !c.correct);
    state = answerLearningChoice(state, wrong.id);
    const view = getLearningView(state);
    assert.equal(state.status, "feedback");
    assert.deepEqual(state.board, p.board);
    assert.deepEqual(state.history, []);
    assert.deepEqual(view.board, wrong.frames.at(-1).board);
    assert.deepEqual(view.highlights, wrong.frames.at(-1).highlights);
    assert.deepEqual(
      restoreLearningAttempt(JSON.parse(JSON.stringify(state))),
      state,
    );
  });

test("a saved incorrect prediction cannot be relabeled as a solved comparison", () => {
  const p = problems.find(
    (p) =>
      p.role === "assessment" && p.assessmentDomain === "conditions-negative",
  );
  let state = createAttempt(p.id, { attemptId: "invalid" });
  state = answerLearningChoice(
    state,
    p.nodes[0].choices.find((c) => !c.correct).id,
  );
  state = {
    ...state,
    status: "solved",
    feedback: {
      ...state.feedback,
      kind: "completed",
      correct: true,
      claim: "comparison",
    },
  };
  assert.equal(restoreLearningAttempt(state), null);
});
