# Learning path v3 — evidence and integration

`dist/learning-path.js` is a pure evidence ledger. The caller supplies the curriculum version, dates, problem metadata and results. It has no clock, scheduler, notification, background resumption or timer. `dist/learning.js` retains the existing exercise judge and adds encounter tracking to its compatibility statistics.

## Meaning and design thresholds

- 閲覧: a lesson or answer exposure. It does not complete practice or assessment.
- 練習: a completed lesson. It does not confer independent assessment credit.
- 初回確認: either complete two genuinely different assessment families independently, or meet the unit's complete execution conditions in two separate eligible full games on novel structural positions. Different game IDs alone are insufficient: the required condition categories below must also be covered. The method is recorded separately, and one family plus one game cannot be combined. The assessment route requires no hints, answers, mistakes, unknown selections, retries or earlier exposure; two distinct authored `branchId` conditions must be represented. Priority explicitly requires both `own-win-first` and `prevent-immediate-loss`. Where `requiresBranch:true`, the learner must actually make a move after an opponent move in the attempt history. A correct first move alone cannot satisfy this.
- 保持確認: after initial confirmation, complete an unseen structural assessment or observe a valid unit-specific success in a new eligible full game, on another supplied calendar date and at least 24 hours after initial confirmation. The game must begin after initial confirmation. The method is recorded separately; the new assessment may belong to a previously assessed family. The learner opens this manually; merely waiting never starts a task. This observes short-term retention, not lasting mastery.
- 実戦遂行: validated opportunities and successful responses on novel structural positions in eligible ordinary full games. Missing opportunities are not successes or failures. Lesson, journey objectives, recovery from a review position and exam results remain distinct evidence roles.

Two families or two separate games, a 24-hour interval and ten exam games are product design criteria and observation categories, not scientific validation, certified ranks, demonstrated learning effectiveness, a human strength rating or a guarantee of future wins. Completing the fixed bank does not certify general Gomoku mastery. The unit label still distinguishes retention and practical evidence after initial confirmation, while the standard path can advance after initial confirmation.

## Identity and contamination

`positionFingerprint(board)` computes an identity for the entire 15×15 stone structure. D4 rotations, reflections and translations share an identity. This is deliberately conservative about translations toward an edge: a coordinate shift alone never creates new assessment credit. Different IDs or declared family names cannot bypass this identity.

An exposure with a board identifies that structure. A family-only exposure, whose exact board is unknown, conservatively contaminates that family. A problem ID also identifies an encounter. Merely belonging to a known family does not contaminate a different structural board: family diversity is a separate initial-confirmation criterion.

An assessment attempt is an encounter even when failed or abandoned. Repeating it cannot regain initial encounter status. Hints or answer exposures during an ongoing attempt invalidate it. Exposure after a completed independent attempt does not rewrite that historical result. Assistance, errors and retries are monotonically retained across updates and stale snapshots. A known-board clean replay is practice, and cannot clear the compatibility `needsReview` flag or satisfy the ledger's independent criteria.

## API

All functions return new serializable values and do not mutate the input. Persist the returned progress in the app. Pass dates as ISO strings with the application's intended calendar offset; date comparison uses the explicit `YYYY-MM-DD` part, and elapsed-time comparison uses the ISO instant.

```js
createPathProgress(raw = null, legacy = null, { curriculumVersion } = {})
noteExposure(progress, { unitId, problemId, board, fingerprint, family, kind, at })
recordAttemptEvidence(progress, attempt, metadata)
unitStatus(progress, unitId)
selectAssessment(progress, unitId, assessmentProblems, { phase = "initial", at } = {})
nextLearningStep(progress, { units, assessmentProblems, unitId, at } = {})
recordPracticalResult(progress, record)
recordReviewFindings(progress, record, moments, { at } = {})
getExamStatus(progress, { seriesId } = {})
```

`createPathProgress` uses schema version 3, independently of the base lesson curriculum version. Default version is the saved ledger's version, or `"3"`. The app should supply its explicit ledger content version on initial load. Unsupported or changed versions are archived under `legacy`; no old completion promotes to confirmation. Legacy exposure and attempt identities remain known. Pass `createLearningProgress(oldLearningProgress)` as the second argument so legacy `viewedUnits` are expanded into actual lesson-frame fingerprints before migration. The legacy archive retains the provided original records; this module never edits or deletes the app's separate game archive.

The former assessment families `priority/gapped-race` and `priority/multiple-finishes` both demonstrated winning first. On restore they are normalized to the single family `priority/own-win-first`, with `originalFamily` retained on attempts. Their two old successes do not establish the new defensive condition or initial priority confirmation. Other units and actual attempt/game history remain intact. Newly added defense questions use new IDs and `priority/prevent-immediate-loss`; old question IDs are not reassigned to new boards.

`noteExposure.kind` may be `demo`, `hint`, `answer`, `review`, or another caller-owned label. Include each exposed board; the app must call it before presenting hidden assessment guidance. Opening a lesson alone must not mark an unrelated ordinary game assisted.

`recordAttemptEvidence` accepts existing learning attempt states, whose `attemptId`, `problemId`, `status`, `history`, `hints`, `guidanceSeen` and `metrics` are used. `metadata` contains:

```js
{
  role: "lesson" | "assessment" | "journey" | "recovery" | "exam" | "practice",
  unitId, skillId, family, board, fingerprint,
  branchId, requiresBranch, at
}
```

The metadata board is the **initial problem board**, not the attempt's current board. Supply `branchId` for every assessment and explicitly set `requiresBranch:false` only for tasks whose objective ends before any opponent response can occur, such as taking an immediate win. The ledger uses actual opponent→learner history for other tasks. `requiredBranch` is accepted as a branch ID alias. A browser update may record a choosing/feedback/solved state repeatedly under the same attempt ID; it creates one encounter.

`unitStatus` returns:

```js
{
  unitId, viewed, practiced,
  initialConfirmed, currentConfirmed, retained, practicalObserved,
  historicalRetained, historicalRetentionAt, historicalRetentionMethod,
  initialMethod: "assessment" | "practical" | null,
  retentionMethod: "assessment" | "practical" | null,
  initialCount, initialTarget: 2, branchCount,
  initialAssessmentCount, initialPracticalCount,
  practicalConditionsRequired, practicalConditionsObserved,
  initialAt, retentionAt, initialEvidence: [problemId], retentionEvidence,
  initialPracticalEvidence: [{ recordId, ply, conditionId }],
  retentionPracticalEvidence: { recordId, ply, conditionId } | null,
  opportunities, practicalSuccesses, historicalPracticalSuccesses, needsReview,
  reviewPending, practicalPending, // counts
  assessmentReviewPending, // boolean
  assessmentReview, // next unresolved item, or latest resolution; null if none
  assessmentReviews: [{ attemptId, problemId, requiredCondition,
    kind: "retention" | "confirmation",
    stage: "remediation" | "assessment" | "resolved",
    failureOrdinal, failureAt, remediationId, remediationOrdinal,
    resolutionMethod, resolutionOrdinal, resolvedAt, resolutionEvidence }],
  reviewFindings: [{ recordId, ply, unitId, kind,
    requiredCondition,
    stage: "recovery" | "assessment" | "practical" | "resolved",
    recoveryId, assessmentId, practicalRecordId,
    transferMethod: "assessment" | "practical" | null,
    transferEvidence: [{ recordId, ply, conditionId }] }],
  label // 未着手 / 閲覧済 / 練習済 / 確認 1/2 / 保持待ち / 保持の復習 / 確認の復習 / 実戦の復習 / 実戦待ち / 実戦遂行
}
```

`selectAssessment` returns an original bank problem or `null`, preferring a family not yet successfully assessed. It requires `role:"assessment"`. Pending priority reconfirmation or self-game review restricts selection to the failed decision side; an unused question about the opposite side is not a replacement. It never relabels known positions as unseen when the bank is exhausted. `phase:"retention"` additionally checks the supplied date and minimum elapsed time. No call is triggered by the passage of time.

`nextLearningStep` prioritizes unresolved self-game and later-confirmation failures, then selects the first unit lacking initial confirmation or the requested unit's unmet explicit `unit.prerequisites`. Confirmed prerequisites without a new unresolved failure are not assigned again. The standard path starts with an unseen diagnostic assessment. A clean completion leads directly to a different family; two independent families allow the learner to skip that unit's lessons and advance.

A failed, hinted, guided, unknown, retried or exposed assessment requires remediation in that unit only. The module selects an uncompleted lesson in that unit, or its first lesson if they were all completed before the latest diagnostic failure. A completed lesson after that failure releases the next fresh diagnostic. The remedial lesson may use assistance: it is practice, and cannot itself confer initial confirmation. Merely viewing a lesson or reopening an old completed attempt does not discharge the requirement. A subsequent diagnostic failure requires a new remedial completion.

A completed task game after the failure can also discharge remediation when it includes an observed opportunity or objective for that unit. An unfinished game, a game about another unit, or a merely listed but unobserved objective cannot. This permits another diagnostic, without treating the task-game objective as independent confirmation or ordinary full-game evidence. The ledger's `lastFailureOrdinal` and `completedOrdinal` event ordering handles games started earlier but completed later, without consulting the clock. Repeated snapshots do not create a fresh completion or erase a failure.

A missing fresh assessment leads to a task game, without awarding completion or inventing an unseen question. All units and their lessons remain available through the app's separate free-selection route.

```js
{
  kind: "lesson" | "assessment" | "journey" | "review",
  unitId,
  problemId, // lesson or assessment only
  recordId, ply, // review only
  reason: "diagnostic" | "remediation" | "initial" |
          "initial-complete" | "assessment-exhausted" |
          "review-recovery" | "review-transfer" |
          "confirmation-remediation" | "reconfirmation",
  label
}
```

## Confirmation after a later failure

`initialConfirmed` is historical evidence. A subsequent failed, hinted, guided, unknown, retried or exposed assessment creates a new unresolved confirmation review even if initial confirmation and retention had already succeeded. `currentConfirmed` becomes false, `needsReview` becomes true, and the standard route returns to that unit's remediation, including when the caller does not specify a unit. `retained` also becomes false; prior retention remains in `historicalRetained`, `historicalRetentionAt` and `historicalRetentionMethod`.

The required sequence is a newly completed, dated lesson or a legal completed relevant task game after the failure, followed by a newly started and completed independent assessment, or two new eligible games meeting the required execution condition. The confirmation attempt must have valid immutable start and completion dates and must follow the remediation in both ledger order and supplied time. Remediation may be assisted; the subsequent independent evidence may not. An undated failure remains pending. Undated completions, an old solved snapshot, re-saving the failed board, or filling a previously absent timestamp later cannot resolve it.

Priority failures retain their decision side: `own-win-first` cannot be repaired by `prevent-immediate-loss`, or vice versa. Both sides can remain pending simultaneously in `assessmentReviews`; resolving one does not erase the other. If there is no unseen assessment on the failed side, the route offers practice and waits for two new games demonstrating that same side, rather than presenting the opposite question. Other units may use a different authored family when it measures the same failed execution goal, such as a different forcing-order position. After valid reconfirmation, the old initial evidence is unchanged and the current status is restored; retention requires the new qualifying evidence, not the superseded historical result.

## Practical route after bank exhaustion

A finite bank must not reset already encountered boards to "unseen". `nextLearningStep` continues to return a task-game destination when no fresh assessment is available. The eligible ordinary full-game evidence can provide a separate route:

- Two different eligible terminal games must each contain a goal-matched successful event for the unit, covering the required categories below. Multiple events in one game cannot supply the pair, even if both conditions occur in that game. Winning a game alone does not establish any other unit.
- The event has a real odd, one-based Black `ply` within the legal move history, `success:true`, no unknown/missed/retracted outcome, and a supported provenance. Journey-derived events require a recognized `objectiveId`, consistent move/evidence fields and the relevant local board facts. `finish-game` is deliberately excluded: reaching the end is activity completion, not a unit skill. `source:"verified-pattern"` does **not** bypass the goal check: actual play after the event must also satisfy the unit's execution requirement. The analyzer remains responsible for its quantified tactical proof; the ledger replays the observed continuation.
- The event's before-board is reconstructed from the full move history. Its D4/translation fingerprint must differ from every authored lesson, demonstration and assessment board, any earlier recorded exposure or attempt, and every same-length prefix of an earlier recorded game. Earlier unfinished, assisted and task games still establish that a position was encountered, even though they do not grant independent credit. This also prevents a previously played game position from later being selected as an unseen assessment.
- Full-game eligibility still requires an explicit empty start, no assistance or retries, matching settings, a legal terminal replay and matching result. Ordinary/strong/max practice may supply observations when those conditions hold; the strict max settings remain separate requirements of the ten-game exam.

The earliest complete route determines `initialMethod`. `initialAssessmentCount` and `initialPracticalCount` are separate progress axes; `initialCount` is their maximum, not their sum. `initialPracticalCount` stays at one when multiple games repeat only one of two required conditions. The practical route stores actual `(recordId, ply, conditionId)` references. A later new structural event can provide `retentionMethod:"practical"` after either initial route, only in a game begun after initial confirmation and ending at least 24 hours later on another date. No new event, unknown analysis, or absence of the skill opportunity is neutral rather than a success.

| Unit | Observed execution needed for unit credit | Categories required across the initial pair |
| --- | --- | --- |
| priority | Actually take an immediate Black win; separately, with no Black win and exactly one White winning point, actually block it | `own-win-first` and `prevent-immediate-loss` |
| conditions | Create at least two winning points without ending immediately, receive an actual White block, then finish the five | Single-axis `open-four` and multi-axis `crossed-four` |
| opening | Build two connections, observe White remove one geometric route, then extend a surviving route to three; separately prevent an actual early fork threat | `two-axis-response` and `early-threat-defense` |
| defense | Remove all immediate White wins and fork threats from a position with a real fork threat, or win immediately in that situation | `single-axis-threat` and `crossed-threat` |
| order | In the actual winning continuation, create at least two nonterminal fours, each involving the just-played Black stone and separated by White blocking the current winning point | Two novel full games meeting `forcing-order`; a single four never qualifies |
| counter | Block White's immediate winning threat while starting an actual forcing win | `defend-two-finishes` and `defend-forcing-chain` |
| branch | White removes an open-three extension option on one axis; actually switch to an unaffected axis and finish through forcing play | `straight-three-response` and `broken-three-response` |
| prepare | Initially no move can make four; the preparation itself makes neither four nor open three, establishes forcing entries on two axes, and is followed by an actual forcing win after White's reply | `mixed-reserve-entries` and `inside-gap-reserves` |
| practice | Reach an actual Black five at the end of a legal unaided game from empty | Two novel full-game `terminal-win` observations |

The preparation check permits single-point fours as later entries; it does not require an open three or an immediate two-point finish after the quiet move. Its categories distinguish an inside entry on two axes from a mixed inside/outside reserve. The branch check tracks lost extension points, not disappearance of every five-cell geometric window: a blocked outer extension may still leave geometric windows on that axis.

Local successes remain in the raw `opportunities` even when they fail the stronger unit gate. A simple three or one four therefore remains an observed activity, but cannot certify conditions or order. To avoid losing correctly observed compound actions merely because the original event uses another unit's tag, the ledger can derive a target-unit candidate from a validated event plus the complete replay: an early `prevent-fork` can support opening; `stop-five` plus an actual forcing win can support counter; `two-directions` plus the stricter continuation can support branch or prepare. These derivations use the same goal and category gates and leave the raw event unchanged. If the required situation or matching evidence has not occurred, the unit remains unconfirmed; the criteria are not weakened to manufacture progress.

`completedAt` is fixed when terminal play is first recorded. A stable original `source.finished` timestamp takes precedence over the observation timestamp; otherwise the first terminal call's explicit `at` is used. Re-saving a game or attaching later pattern analysis cannot move its completion date forward. Existing saved games without a recorded completion time or stable `finished` time do not acquire a new historical date merely through migration or re-save. `historicalPracticalSuccesses` counts qualifying distinct novel games for that unit, rather than every repeated event.

## Self-game review and later practical transfer

After the review worker returns, call `recordReviewFindings(progress, originalRecord, moments, {at})`. This API accepts only the known failure kinds `miss-win`, `miss-block`, `allowed-pattern`, `allowed-fork`, `allowed-counter`, `allowed-vcf`, and `lost-order`, with `evidence.status:"proven"`. `pattern-play`, `winning-chance`, unknown analysis and unsupported kinds never create a failure. The original move list must replay legally; the moment's odd, one-based `ply`, `actual` move and exact `before` board must match that game's prefix. Missed wins are checked against an actual winning alternative. Other failures require a legal opponent proof line ending in a win; lost order also requires the prior Black winning line. This checks proof attachment and the concrete witness, while the review worker remains responsible for the proof's quantified scope.

Findings are keyed by `(recordId, ply)`, so rerunning analysis does not add duplicate failures, reset their chronology or erase recovery evidence. Only the supplied matching game is affected. The board is retained as an already encountered position. The new `reviewFindings` field is optional when restoring older v3 saves and defaults to empty; changing the ledger content version preserves valid findings as unresolved rather than silently erasing them.

The flow has four separately observable stages:

1. `recovery`: continue from the original before-position. `nextLearningStep` prioritizes `kind:"review", recordId, ply, reason:"review-recovery"`. A previously confirmed unit still has `needsReview:true` and the label `実戦の復習`.
2. `assessment`: after a valid recovery finishes, offer a fresh structural assessment in that unit with `reason:"review-transfer"`. If the bank is exhausted, two separate eligible games begun after recovery can instead supply transfer through valid novel unit-specific successes; `transferMethod` and the two game references distinguish this route. Partial recovery, a replay of the known assessment board or a single review answer does not finish remediation. If the learner fails a new assessment, the normal unit-specific lesson remediation applies.
3. `practical`: the fresh independent assessment or the second valid transfer game ends the immediate remediation (`needsReview:false`) but leaves the label `実戦待ち`. The normal path continues to other unconfirmed units; waiting for a practical opportunity never locks the whole curriculum.
4. `resolved`: another eligible unaided full game, begun after the transfer confirmation, contains a valid successful opportunity on a new structural position for that unit. The two transfer games cannot also supply this later observation. Games without that opportunity are neutral. Unknown or retracted opportunities, assisted games, partial starts and prior successes cannot resolve the finding.

Priority review also preserves `requiredCondition`: `miss-win` requires winning-first transfer and later winning-first performance, while `miss-block` requires blocking transfer and later blocking performance. The opposite decision side cannot close either stage. When that side's unseen bank is exhausted, two separate novel games demonstrating the same side can supply transfer; the following practical observation still requires another new game on that side.

Recovery records must use `role:"recovery"` and include `sourceReview:{recordId,ply,before}`, `startPly`, `startBoard`, the **full original prefix plus continuation** in `moves`, `completed:true`, and `result`. The ledger verifies the source reference, exact prefix, before-board, `startPly === ply - 1`, legal play through an actual terminal position and matching result. A legal win, loss or draw counts as having continued to the end; this is not a win or ordinary full-game certification. A caller-supplied `completed:true` by itself is insufficient. Recovery remains excluded from independent full-game performance.

Call `recordPracticalResult` when an ordinary game starts as well as when it changes or finishes. Its initial ordinal distinguishes a new game from one already in progress before the assessment. Historical practical successes remain visible in `historicalPracticalSuccesses`; `practicalObserved` and `practicalSuccesses` do not reuse them to conceal an unresolved later finding. The review stages are derived from persisted evidence on each read, with no scheduled transitions.

## Games and ten-game challenge

```js
recordPracticalResult(progress, {
  id, role: "practice" | "exam" | "journey" | "recovery", at,
  seriesId, // explicit new exam series, required for exam eligibility
  rule: "freestyle15", level, assisted: false,
  startBoard: Array(225).fill(0),
  settings: { rule: "freestyle15", level, strength, timeMs },
  startSettings: { rule: "freestyle15", level, strength, timeMs },
  moves: [{ i }], result: "win" | "loss" | "draw" | "resign" | "unfinished",
  opportunities: [{ unitId, success: true | false | null, outcome }]
})
```

The full game filter independently replays legal alternating moves from an explicitly empty board and verifies actual termination and the reported outcome. The final settings must match the initial settings. Missing metadata, assistance, retries, partial starts, invalid moves, resignation and interruption are excluded from unaided terminal full-game results. They are still preserved with reasons. Practical successes count only eligible full games, not a journey/review objective. Journey and recovery results may pass their own result shape and are retained under their own role without promotion to full games.

An exam additionally requires an explicit series ID, `level:"max"`, `strength:100` and `timeMs:8000`. The app records these settings when it creates the game, not retroactively for old games. `getExamStatus` defaults to the most recently recorded explicit exam series; an explicit `seriesId` selects that series. Existing play records never become exam results merely because their level was max.

```js
{
  seriesId, kind: "observed-performance", label: "観測成績", target: 10,
  games, wins, losses, draws, recentGames, recentWins,
  attempts, assisted, unfinished, resigned, invalid,
  challengeCompleted, excludedGames, recordIds
}
```

`challengeCompleted` requires exactly ten recorded attempts in the series and ten eligible wins. A resignation, abandoned attempt or assisted result cannot be hidden by appending replacement wins to the same series. A new challenge is a new user-initiated series. The separate counters may overlap (an assisted unfinished attempt is both); `excludedGames` counts unique excluded records. The result describes those observed games only.

## Compatibility statistics and verification

`createLearningProgress`, `recordLearningAttempt`, `recordLessonView`, and `getLearningStats` retain their signatures. Progress schema 1 now carries `evidenceVersion:2`, `exposures`, and per-attempt `fingerprint`, `priorExposure`, `legacyEvidence`. Legacy completions remain practice history and receive no independent first-encounter credit. `lastOutcome:"unaided"` still describes the inputs in that attempt only; use `knownCompleted`, `independentCompleted`, and the new ledger for encounter/confirmation meaning.

`tests/learning-path.test.mjs` covers the audit's demo→answer and hint→immediate-replay cases, D4/translation aliases, independent family progression, actual branch continuation, mid-attempt exposure, manual retention boundaries, later confirmation failures, side-specific remediation, prerequisites, bank exhaustion, priority-family migration and full-game exclusion/series boundaries. The audit's two nine-move counterexamples cannot certify conditions or order through either event source. Authored-strength order, conditions, opening, defense, counter, branch and quiet-preparation continuations embedded in novel legal full games remain accepted through actual journey events. A preparation counterexample with an already available four is rejected. Tests validate implementation and authored criteria; they are not learner outcome evidence.
