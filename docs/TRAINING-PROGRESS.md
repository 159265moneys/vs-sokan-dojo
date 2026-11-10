# Local practice progress

`dist/training-progress.js` is an immutable, serializable helper module. Persist its returned state under a new local-storage key, separate from legacy `sokan.progress`. Hydrate with `createTrainingState(raw)`; version 1 alone is accepted. Legacy counters cannot grant a new badge.

## Integration

- `recordTrainingAttempt(state, { themeId, variantId, completed, firstTry, hinted, wrongAttempts })` returns new state. Call **once per whole puzzle**, after the last required black move or when an attempted puzzle is abandoned. Never call after each stone. `completed: true` is required for a clean completion; any hint, incorrect attempt, or `firstTry: false` excludes it. Carry these flags across every step of a sequence.
- `variantId` must be a stable identity for the tactical geometry, transform and translation, never a fresh UUID. Re-answering the same board adds practice attempts but not unique variants.
- `getThemeStats(state, themeId)` includes counts, `firstTryAccuracy` from 0 to 1, `uniqueCleanVariants`, `due`, and `status: "new" | "practiced" | "passed"`.
- `passed` requires at least five distinct clean, complete variants and a clean answer on a new variant after at least three intervening answered puzzles. A later wrong or assisted answer revokes the badge until another separated clean answer on a new variant. This is an app checkpoint, **not proven human mastery or universal perfect play**. Suggested short label: `確認済`.
- `chooseNextTheme(state, themeIds)` selects due missed themes first, then unseen themes, then due clean rechecks. Clean rechecks cannot indefinitely exclude unseen material. It uses only answered-puzzle counts. It never creates timers, scheduled work, notifications or background tasks. A restricted one-theme practice mode may repeat immediately, but that repetition cannot satisfy the separated-recheck condition.
- `startTrainingSession(state, 5)` starts a fresh five-question set. `getSessionSummary(state)` returns size, answered, remaining, completed, clean, firstTryAccuracy, done and weakThemes. Once the set ends, later answers do not change its summary. The caller renders an end card and explicitly starts another set.

## Exact tactical mistakes

`enqueueTacticalMistake(state, { id, board, kind, actual?, side?, recordId?, moveIndex? })` accepts a 225-cell array/typed array and only `kind: "miss-win" | "miss-block"`. It rejects terminal/invalid positions, inconsistent stone counts, speculative engine evaluations, already correct actual moves and forced losses with multiple enemy wins. Invalid or duplicate input returns the original state.

All accepted answers are recalculated from the board: every own immediate five-in-a-row win, or the sole mandatory block when no own immediate win exists. A supplied `answers` field is intentionally ignored. `getTacticalMistake(state)` returns a defensive copy of the oldest item. `removeTacticalMistake(state, id)` removes it after caller-confirmed completion. Keep the item while an assisted/incorrect attempt needs another practice pass if desired.

## Evidence boundary

These checks verify a usable practice mechanism and truthful counters. They do not establish long-term learning, real-game improvement, retention after days, the entire winning strategy from the initial board, or the shortest winning distance against perfect play. Those claims require separate evidence.
