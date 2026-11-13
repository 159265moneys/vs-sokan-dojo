import test from "node:test";
import assert from "node:assert/strict";
import { createAttempt, playLearningMove, getLearningView } from "../dist/learning.js";
import { parse } from "../dist/game.js";
import { problems } from "../dist/curriculum.js";

test("a correct early block explains the opponent's actual fork and lights its support", () => {
  const start = createAttempt("prevent-junction");
  assert.equal(getLearningView(start).feedback.text, "");
  const done = playLearningMove(start, parse("H8")), view = getLearningView(done);
  assert.equal(done.status, "solved");
  assert.match(view.feedback.text, /白H8/);
  for (const c of ["E8", "J8", "H4", "H9"]) assert(view.feedback.text.includes(c));
  assert.match(view.feedback.text, /先に黒H8/);
  const danger = view.highlights.filter((h) => h.tone === "danger");
  assert.deepEqual(new Set(danger.flatMap((h) => h.cells)), new Set(["F8", "G8", "I8", "H5", "H6", "H7"].map(parse)));
  assert(danger.flatMap((h) => h.cells).every((i) => view.board[i] === 2));
  assert(danger.flatMap((h) => h.points).every((i) => view.board[i] === 0));
});

test("an outside block explains the remaining single completion instead of pretending the opponent cannot make four", () => {
  const done = playLearningMove(createAttempt("check-defense-gap-a"), parse("B10"));
  assert.equal(done.status, "solved");
  const view = getLearningView(done);
  assert.match(view.feedback.text, /白E10/);
  assert.match(view.feedback.text, /黒B10で外側/);
  assert.match(view.feedback.text, /G10だけ/);
  assert(!view.highlights.flatMap((h) => h.points).includes(parse("B10")));
});

test("all accepted preemptive-defense answers keep their concrete after-board and nonempty reason", () => {
  for (const p of problems.filter((p) => p.judge?.kind === "prevent-fork")) {
    for (const i of p.guide) {
      const start = createAttempt(p.id), done = playLearningMove(start, i);
      assert.equal(done.status, "solved", p.id);
      const view = getLearningView(done);
      assert.equal(view.board[i], 1, p.id);
      assert(view.feedback.text.length > 0, p.id);
      for (const h of view.highlights) {
        assert(h.cells.every((j) => view.board[j] !== 0), p.id);
        assert(h.points.every((j) => view.board[j] === 0), p.id);
      }
      assert.equal(start.board[i], 0, "explaining does not mutate the previous question");
    }
  }
});
