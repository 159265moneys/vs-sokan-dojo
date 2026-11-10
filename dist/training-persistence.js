import {
  createTrainingState,
  recordTrainingAttempt,
} from "./training-progress.js";

// A single localStorage value contains both progress and the in-flight attempt.
export function practiceSnapshot(state, activeAttempt = null) {
  return {
    ...state,
    activeAttempt: activeAttempt
      ? {
          themeId: activeAttempt.themeId,
          variantId: activeAttempt.variantId,
          hinted: activeAttempt.hinted === true,
          wrongAttempts: Number.isSafeInteger(activeAttempt.wrongAttempts)
            ? Math.max(0, activeAttempt.wrongAttempts)
            : 0,
        }
      : null,
  };
}
export function restorePractice(raw) {
  let state = createTrainingState(raw);
  let interrupted = false;
  if (raw?.activeAttempt) {
    try {
      state = recordTrainingAttempt(state, {
        ...raw.activeAttempt,
        completed: false,
        firstTry: false,
      });
      interrupted = true;
    } catch {}
  }
  return { state, interrupted };
}
