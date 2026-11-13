import test from "node:test";
import assert from "node:assert/strict";
import { problems } from "../dist/curriculum.js";
import {
  createAttempt,
  answerLearningChoice,
  playLearningMove,
  restoreLearningAttempt,
} from "../dist/learning.js";
const copy = (x) => JSON.parse(JSON.stringify(x));
const compared = problems.filter((p) =>
  p.nodes?.some((n) =>
    n.choices.some((c) => c.correct && c.continuations?.length),
  ),
);

test("every continuation-required comparison rejects a missing exercise or a fabricated prediction-only completion", () => {
  for (const p of compared) {
    const choice = p.nodes[0].choices.find(
      (c) => c.correct && c.continuations?.length,
    );
    const state = answerLearningChoice(
      createAttempt(p.id, { attemptId: p.id }),
      choice.id,
    );
    assert(restoreLearningAttempt(copy(state)), p.id);
    const missing = copy(state);
    missing.exercise = null;
    assert.equal(
      restoreLearningAttempt(missing),
      null,
      p.id + " missing exercise",
    );
    const fake = copy(state);
    fake.exercise = null;
    fake.status = "solved";
    fake.feedback = {
      ...fake.feedback,
      kind: "completed",
      correct: true,
      claim: "local-goal",
      choiceId: choice.id,
    };
    assert.equal(
      restoreLearningAttempt(fake),
      null,
      p.id + " prediction-only completion",
    );
  }
});

test("the claimed board move must be the actual last human input, not an earlier authored stone", () => {
  for (const p of compared) {
    const choice = p.nodes[0].choices.find(
      (c) => c.correct && c.continuations?.length,
    );
    const state = answerLearningChoice(
      createAttempt(p.id, { attemptId: p.id }),
      choice.id,
    );
    const good = playLearningMove(state, state.guide[0]);
    assert.equal(good.status, "solved", p.id);
    assert(restoreLearningAttempt(copy(good)), p.id + " legitimate completion");
    const altered = copy(good);
    altered.feedback.move =
      altered.history.find((m) => m.i !== good.history.at(-1).i)?.i ??
      (good.history.at(-1).i + 1) % 225;
    assert.equal(
      restoreLearningAttempt(altered),
      null,
      p.id + " mismatched last move",
    );
    const checkpoint = copy(good);
    checkpoint.checkpoint.nodeId = "start";
    assert.equal(
      restoreLearningAttempt(checkpoint),
      null,
      p.id + " wrong resume stage",
    );
  }
});
