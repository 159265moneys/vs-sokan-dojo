# Record drill core v7

`dist/record-drills.js` extracts questions from legal, original, empty-board game records. It is independent of the browser, CPU play, curriculum qualification and persistence. `dist/record-drill-worker.js` supplies extraction and attempt transitions off the UI thread.

## Source and extraction contract

```js
const questions = await extractRecordDrills(record, {
  sourceKind: "own", // own | library | import; never infer ownership from result
  sourceLabel: "自分の実戦",
  sourceId: record.id,
  minStones: 14,
  minProofPlies: 3,
  maxQuestions: 4,
  minPlyGap: 6,
  includeImmediate: false,
  seenFingerprints: [],
  proofLimits: { maxPly: 9, maxNodes: 450, quietDepth: 2 },
  onProgress(progress) {},
});
```

`record` uses `rule: "freestyle15"`, optional `level`, and original `moves` as integer points or `{i}` objects. Object `side`/`color`, when present, must agree with alternating Black/White. `startPly` must be absent or zero; lesson and authored snapshot sources are rejected. Duplicate/out-of-range points, moves after a win, or unsupported rules reject the entire record. Empty or unknown-only valid records return no questions. They never receive an invented fallback puzzle.

The core calls `scanRecord`, then dynamically verifies alternatives with `judgeReviewMove`. By default both sides' immediate five-completion positions are excluded; these and shallow/sparse positions cannot fill the bank simply because no rich position exists. Mistakes, missed winning chances, and winning pattern plays are eligible. Selection prioritizes mistakes and deeper decisions, suppresses nearby positions and suffixes within the same proof sequence, and caps output. The canonical fingerprint follows D4/reflection/translation equivalence for duplicate detection only. The actual source, board, coordinates and move order are never transformed, cropped or supplemented.

The returned array has `.coverage` with scan coverage, exclusion counts and extracted/eligible counts. JSON serialization of an array omits custom properties, so persist coverage separately if needed. The worker sends `questions` and `coverage` separately.

Each question is compact and JSON-serializable:

```js
{
  version: 7,
  id: "record-v7-<recordHash>-<ply>-<boardHash>",
  color: 1,
  source: {
    kind: "own", label: "自分の実戦", recordId: "...",
    recordHash: "...", moves: [/* full, original, point-only game */],
    result: "loss", level: "strong"
  },
  ply: 15,
  prefix: [/* exactly source.moves.slice(0, ply - 1) */],
  before: [/* exact original 225-cell board */],
  fingerprint: "board:...",
  proofPlies: 7,
  proofLimits: {maxPly: 9, maxNodes: 450, quietDepth: 2},
  maxContinuationPlies: 9,
  moment: {
    kind: "allowed-vcf", actual: 111, alternatives: [/* verified candidates */],
    scope: "line-prevented", evidence: {/* compact proof */},
    priorWinningProof: null,
    alternativeDetails: [/* move, scope, compact proof */],
    patternType: null, skillId: "defense", explanation: "..."
  },
  integrity: "..."
}
```

Full source moves cost at most 225 integers; the real 22-ply loss question is approximately 1.6 KB. Questions contain no frame arrays. Proof metadata is limited to source/evidence needed for regrading and explanation, not every scanner frame.

`recordSourceHash(record)` identifies the rule plus complete ordered move list. IDs remain stable when an imported record is renamed or changes library ownership. `verifyRecordDrill(q, optionalOriginalRecord)` checks version, material checksum, source legality, exact prefix and board, side, fingerprint, ID and optional original-record equality. It performs no search (approximately 0.1 ms for the 22-ply fixture on the development machine).

These deterministic checksums detect accidental corruption; they are not signatures. A self-consistent object fabricated by an adversary is not an authenticated game record. Raw imported question objects must not become trusted questions merely because they contain a checksum. Validate/re-extract their original game, and establish ownership/source kind from the application record store. `restoreRecordDrill` assumes its `q` is this separately trusted question and never accepts source/board/grade claims from the persisted attempt.

## Attempt transitions

All transitions return new JSON-serializable state and do not mutate arguments.

- `startRecordDrill(q, {attemptId})` starts on the exact source board and retains the actual move prefix.
- `playRecordDrill(q, state, point)` dynamically grades any legal point. Illegal or inactive input leaves the state unchanged.
- `hintRecordDrill(q, state)` exposes one additional `tacticalHintStages` stage; no neighborhood glow or pre-filled givens are introduced.
- `answerRecordDrill(q, state)` explicitly reveals a verified correction/proof. It also works after refuted/unknown input and after completion. Failed continuation answers reconstruct the preceding decision board and retained proof checkpoint.
- `hideRecordDrillHints(q, state)` closes visible hints/answers on re-entry. It records a `hide-hints` event, preserving all cumulative assistance/exposure metrics and deterministic restoration. Call after restoration before displaying a reopened attempt when hints must be closed.
- `retryRecordDrill(q, state)` returns to the exact source position within the same attempt and retains cumulative history.
- `getRecordDrillView(q, state)` is the presentation boundary.
- `restoreRecordDrill(q, rawState)` replays allowlisted events against the trusted question and returns reconstructed state only if it exactly matches the supplied snapshot; otherwise it returns `null`.

State `status` is `ready`, `continuing`, `refuted`, `unknown`, or `completed`. `result` is null, `line-prevented`, or `black-win`. A verified local prevention finishes the local exercise but never claims a global win. A forced win requires each future Black move from the player; the core places only one proof-driven White response at a time. It dynamically accepts verified alternatives at every Black decision and bounds the complete continuation to nine plies. A Black five must exist on the actual board before `black-win` is awarded. Bounded search failure yields `unknown`, never an error or completion.

`metrics` contains cumulative `assisted`, `hints`, `answers`, `errors`, `retries`, `exposures`, `unknown`, and `completed`. Hint closing, answer viewing, retries and restoration cannot clear them. Refuted choices increment errors; unknown choices do not. `qualification` is always `{fullGame:false, independentCurriculum:false}`. The original prefix is source history, not newly played performance evidence.

Events are restricted to `play` with an integer `point`, and `hint`, `answer`, `hide-hints`, `retry` with no extra fields. The recent journal is bounded to 256 events. Reaching that bound is valid and restorable; the next transition (including a no-op hint close) compacts it instead of refusing further interaction. A checkpoint retains at most 16 canonical replay events for the active round plus cumulative metrics, the absolute event ordinal, and a corruption checksum. Earlier retry rounds and redundant hint/answer visibility toggles become cumulative receipts. The actual current Black choices are always replayed from the exact trusted source prefix, and compaction rejects any difference in board, moves, plan, status, feedback or explanation frames. It never substitutes a snapshot board for replay.

`eventOffset + events.length` is the monotonic absolute action ordinal even when the recent array is cleared. `completionEventOrdinal` is the absolute original successful play ordinal, preserved through later explanations/checkpoints and cleared on retry. `metrics.completed` counts successful local exercises across retries/checkpoints, so the bank can reconcile a missed save even after another round has started. Neither field qualifies a full game or independent curriculum performance.

Restoration validates checkpoint source/attempt binding and checksum, replays its canonical active events, checks cumulative counters against the replayed minimums and event-count bounds, then replays the recent tail. Counter edits, altered current choices, source/ordinal changes or inconsistent saved snapshots reject restoration. Prototype v7 snapshots from before checkpoint support are accepted only when all four newly introduced fields are absent (`eventOffset`, `checkpoint`, `completionEventOrdinal`, `metrics.completed`), their entire original journal is present, and exact replay validates every previously supported field. They are then upgraded with replay-derived values; arbitrary partial omissions are rejected.

Checkpoint receipts are local continuity records, not cryptographic evidence of historical performance. Checksums detect accidental edits; someone rewriting a whole local store can also recompute them or delete an entire attempt. Compacted historical rounds cannot be independently re-proved from their cumulative receipt, and never grant full-game or curriculum qualification. The bank owns lifetime exposure/attempt watermarks. Current board/proof correctness remains independently replayed against the trusted question even when old counters are summarized.

## Blind view and explanations

The initial view says only `次の一手を選ぶ`, shows the exact board and neutral source category/ply, and has empty `givens`, `highlights`, `explanationFrames`, `refutationFrames`, feedback and completion. It contains no source outcome, tactical goal/type, winning coordinate list, source move list, or proof plan. Do not bind raw questions, plans, or source outcomes directly into the blind UI.

The view provides `board`, `last`, `color`, `source:{kind,label,recordId,ply}`, status, `canPlay/canHint/canAnswer/canRetry`, `hintStage`, `highlights`, `feedback`, `refutationFrames`, `explanationFrames`, `completion`, metrics and qualification. `feedback` uses `title`, `text`, and optional `explanation`; after defensive alternatives it is derived from that specific move's assessed frames rather than from a canonical answer's unrelated explanation.

`refutationFrames` exposes the original failed answer’s counterplay only while status is `refuted`. Its private `feedbackFrames` source is kept separately from solutions, so requesting a correction cannot overwrite the counterplay, including across hide/reload/replay. `explanationFrames` contains the correction/winning line after completion or an explicit answer request. They remain empty in blind and continuing views unless an explanation was explicitly requested. Continuing after a correct Black move clears visible hints and future proof frames; feedback can name White's already-played reply but does not reveal the next Black answer. A separate explanation pager should open only through the UI's explicit explanation action. Source details still should not be used to disclose outcomes before answering.

## Worker protocol

Every message carries a caller-supplied request `id`. Version is `record-drills-v7`.

```js
{type:"extract", id, version:"record-drills-v7", record, options}
{type:"grade", id, version:"record-drills-v7", question, state, point}
{type:"start", id, question, options:{attemptId}}
{type:"hint"|"answer"|"hide-hints"|"retry"|"restore", id, question, state}
```

Responses are serializable:

```js
{type:"progress", id, version, done, total, moments}
{type:"result", command:"extract", id, version, questions, coverage}
{type:"result", command, id, version, state, view}
{type:"error", command, id, version, error:"message"}
```

`handleRecordDrillMessage(data, post)` is also importable in Node tests. The browser wrapper installs a module-worker message listener. Use a distinct grading worker if a long extraction should not delay a user answer. Extraction of the existing H7 expert game can take roughly 14 seconds; progress is emitted at every source ply.

## Validation

`node --test tests/record-drills-v7.test.mjs` verifies:

- The anonymous `tests/fixtures/record-drill-qa-loss-v7.json` is the exact 22-ply game from an assistant-operated local UI playthrough. It retains the 14-stone position before Black's 15th move and the full original prefix. It contains no personal identifiers, is not a shipped seed, and makes the test reproducible without local artifact files.
- All 211 legal first responses in that fixture: 3 accepted local defenses, 208 refuted responses, no fixed answer-coordinate-only grading.
- All three complete `expert-courses.json` games: dense decision positions at plies 37/29/19, proof depths 7/7/9, forced suffixes suppressed, and every retained first answer played to an actual Black five through explicit player choices.
- Neutral views, explicit narrow hints, no future answer leak during continuation, cumulative metrics, hint closing and replay, and explicit explanations after failed continuation decisions, separate failed-line/correction replay, and completed-game explanations from the original decisive move.
- Unknown status, illegal/authored/terminal-before source rejection, sparse/unknown-only exclusions, renamed/import source IDs, canonical duplicate suppression and worker errors/progress.
- Restore rejection for changed metrics, events, boards, move prefixes, source hashes, qualifications, versions and question evidence.
- Exactly 256 events remain usable; more than 512 hint/hide/retry actions across multiple checkpoints preserve a partial winning sequence, continue after reload to an actual five, retain assistance/errors/retries/completions, and keep stable absolute completion IDs. Checkpoint tampering and malformed legacy upgrades are rejected.
