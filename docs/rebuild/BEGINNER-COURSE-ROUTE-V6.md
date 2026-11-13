# Beginner course route v6

## Problem and scope

The evidence-oriented `nextLearningStep` diagnoses first and requires independent
confirmation before advancing prerequisites. With a finite bank, a learner who
uses hints on both winning-decision checks can exhaust priority's four baseline
checks while still lacking that condition. The old recommendation then becomes
a task game at the first unit.

`dist/course-route.js` adds a separate beginner navigation policy. It changes no
qualification rules in `learning-path.js`, no saved schema, and no existing
attempt, exposure, review, or game record. It owns no clock, schedule, or cursor.

## API

```js
nextCourseStep(progress, {
  units,
  assessmentProblems,
  unitId: null, // optional selected unit
  at: null,    // caller-supplied assessment time
});

courseProgressSummary(progress, { units });
```

The next-step result retains the existing `lesson`, `assessment`, `review`, and
`journey` shapes. Ordinary queued lessons use `reason: "course-lesson"`. Every
journey result adds `guided: true`; the application must dispatch it to its guided
game entry point. A final course journey has `reason: "course-practiced"` and
`pendingConfirmationUnitIds`. Only when every supplied unit is currently
confirmed does its reason remain `"initial-complete"`.

The summary returns per-unit authored lesson counts, remaining lesson IDs,
`practiced`, and the unchanged `currentConfirmed` status. Totals include
`lessonCount`, `completedLessonCount`, `practicedUnitCount`,
`confirmedUnitCount`, `pendingConfirmationUnitIds`, `coursePracticed`, and
`allConfirmed`. `coursePracticed` means that each supplied unit has either all
its lessons completed or existing current independent confirmation. Its
`practicedUnitCount` counts actual lesson completion only.

## Navigation and evidence boundaries

1. Rebuild solved lesson IDs from normalized ledger attempts with the matching
   unit, `role: "lesson"`, and `status: "solved"`. An unfinished lesson, an
   assessment using a lesson ID, or an attempt belonging to another unit cannot
   complete this queue.
2. Give actual game recovery global priority, even when another unit is selected.
3. Serve pending confirmation remediation, including a later domain failure
   whose remediation could otherwise be hidden behind an earlier exhausted
   reconfirmation. Initial failed/assisted checks also require later remediation.
4. Serve available reconfirmation and real-game transfer checks before ordinary
   course work. If their finite supply is exhausted, finish that unit's remaining
   lessons before allowing subsequent practice. Their pending evidence remains
   in the ledger.
5. For the next unconfirmed unit, finish its authored lesson IDs in order, then
   use the original independent assessment selection. A taught prerequisite
   permits practice in its successor even when confirmation is still pending.
   An untaught prerequisite is visited first. Existing confirmed units are skipped.
6. When no fresh baseline/domain assessment remains after the unit's lessons,
   continue to the next unit. An explicit selected unit falls forward through
   subsequent units before wrapping to earlier unfinished work.
7. After the finite course, recommend a guided game. Remaining confirmation and
   transfer deficits are preserved and reported; lesson completion never supplies
   independent assessment, practical-game, retention, or exam credit.

The underlying `nextLearningStep` is called with a single target unit whose
prerequisites are cleared only in that temporary routing argument. The ledger
passed to it remains intact. Qualification is always read from `unitStatus`.

## Verification

Command:

```sh
node --test tests/course-route-v6.test.mjs tests/learning-path.test.mjs tests/assessment-supply-v5.test.mjs
```

Result: **133 passed, 0 failed**, including 25 course-route tests.

Coverage includes:

- Empty progress, all 40 authored lessons across nine units, and restoration
  without a separate navigation cursor.
- The reported priority sequence: two winning checks completed with hints,
  matching subsequent remediation, two defensive checks completed cleanly,
  all four baseline checks exhausted, then the conditions lesson with priority
  still unconfirmed.
- A full scripted learner traversal from empty progress that uses a hint on
  every check, completes remediation, reaches every unit's authored lessons,
  and finishes at a guided course game with all nine confirmations still pending.
- Each of the 15 required assessment domains: hinted failed confirmation,
  matching remediation, finite authored/reserve supply exhaustion, and subsequent
  lesson progression with that domain's reconfirmation still pending.
- Global real-game recovery and available transfer, retained pending transfer
  on exhaustion, global later-confirmation remediation, and a later domain's
  remediation behind an older exhausted reconfirmation.
- Purity and restore parity; existing all-confirmed users retain the
  `initial-complete` outcome without being forced through old lessons.
- Existing qualification, freshness, retention, review, and supply suites remain
  unchanged and passing.

These are deterministic state-transition tests using the application's learning
APIs and authored legal solution paths, with explicit hint use where relevant.
They verify navigation and evidence accounting; they do not establish human
learning effectiveness or replace the application's separate browser playthrough.
The helper does not itself launch a board, so the caller's guided-journey dispatch
must also be verified in the application.
