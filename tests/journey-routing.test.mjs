import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parse } from "../dist/game.js";
import {
  journeyTracks,
  createJourney,
  playJourneyMove,
  applyJourneyReply,
  getJourneyView,
  getJourneyResult,
} from "../dist/journey.js";

// Exercise the production controllers without booting app.js's DOM and Worker.
const app = readFileSync(new URL("../dist/app.js", import.meta.url), "utf8");
const guided = app.slice(
  app.indexOf("function startGuidedNext()"),
  app.indexOf("function practiceLevelFor("),
);
const reply = app.slice(
  app.indexOf("async function journeyReply()"),
  app.indexOf("function recordGameEvidence()"),
);
const startAction = app.match(
  /"journey-start": \(el\) => \{([\s\S]*?)\n  \},\n  "journey-variant"/,
)[1];
const copy = (x) => JSON.parse(JSON.stringify(x));
function play(state, pairs) {
  for (const [black, white] of pairs) {
    state = playJourneyMove(state, parse(black));
    if (white) state = applyJourneyReply(state, parse(white));
  }
  return state;
}
function built(switched = false) {
  const s = play(
    createJourney("build", { attemptId: switched ? "built-switch" : "built" }),
    switched
      ? [
          ["J8", "A1"],
          ["H10", "C1"],
          ["H8", "I8"],
          ["H9", "E1"],
          ["H11", "H7"],
          ["H12"],
        ]
      : [
          ["H6", "A1"],
          ["F8", "C1"],
          ["G8", "E1"],
          ["H8", "G1"],
          ["I8", "I1"],
          ["J8"],
        ],
  );
  return { ...getJourneyResult(s), role: "journey" };
}
function branch(variant = "E8", finish = true) {
  const line = {
    E8: [["H8", "E8"], ["H5", "H9"], ["H4"]],
    I8: [["H8", "I8"], ["H9", "H5"], ["H10"]],
    H9: [["H8", "H9"], ["I8", "E8"], ["J8"]],
    H5: [["H8", "H5"], ["E8", "I8"], ["D8"]],
  }[variant];
  return {
    ...getJourneyResult(
      play(
        createJourney("branch", { attemptId: variant, replyVariant: variant }),
        finish ? line : line.slice(0, 2),
      ),
    ),
    role: "journey",
  };
}
function route(records) {
  let decision;
  vm.runInNewContext(`${guided}\nstartGuidedNext();`, {
    pathProgress: {
      practicalResults: Object.fromEntries(
        records.map((source, i) => [i, { source }]),
      ),
    },
    problems: [{ id: "prevent-junction", board: [] }],
    positionMoves: () => [],
    levels: {
      normal: { ms: 700, strength: 65 },
      strong: { ms: 1500, strength: 85 },
    },
    startJourney: (track, options = {}) => {
      decision = { track, options: copy(options) };
    },
    startExam: () => {
      decision = { exam: true };
    },
  });
  return decision;
}

test("the standard route requires a completed opening build with the actual four objective", () => {
  assert.equal(route([]).track, "build");
  const ready = built();
  assert.equal(ready.completed, true);
  assert.deepEqual(route([ready]), {
    track: "branch",
    options: { replyVariant: "E8" },
  });
  for (const altered of [
    { ...ready, completed: false },
    { ...ready, fromOpening: false, startPly: 8 },
    {
      ...ready,
      opportunities: ready.opportunities.filter(
        (o) => o.objectiveId !== "force-four",
      ),
    },
    {
      ...ready,
      opportunities: ready.opportunities.map((o) =>
        o.objectiveId === "force-four" ? { ...o, retracted: true } : o,
      ),
    },
    { ...ready, opportunities: [] },
  ])
    assert.equal(route([altered]).track, "build");
});

test("unobserved switching requires both real horizontal and vertical branch completions", () => {
  const ready = built(),
    horizontal = branch("E8"),
    vertical = branch("H9");
  assert.deepEqual(route([ready, horizontal]), {
    track: "branch",
    options: { replyVariant: "H9" },
  });
  assert.deepEqual(route([ready, branch("I8")]), {
    track: "branch",
    options: { replyVariant: "H9" },
  });
  assert.equal(route([ready, horizontal, vertical]).track, "defend");
  assert.equal(route([ready, branch("I8"), branch("H5")]).track, "defend");
  assert.deepEqual(route([ready, branch("E8", false)]), {
    track: "branch",
    options: { replyVariant: "I8" },
  });
  assert.deepEqual(route([ready, horizontal, branch("H9", false)]), {
    track: "branch",
    options: { replyVariant: "H5" },
  });
});

test("a requested white variant, a withdrawn switch or finishing without the switch is not branch completion", () => {
  const ready = built(),
    horizontal = branch("E8"),
    vertical = branch("H9");
  for (const altered of [
    { ...horizontal, branchOverride: null },
    { ...horizontal, white: { ...horizontal.white, kind: "natural" } },
    {
      ...horizontal,
      opportunities: horizontal.opportunities.filter(
        (o) => o.objectiveId !== "switch-direction",
      ),
    },
    {
      ...horizontal,
      opportunities: horizontal.opportunities.map((o) =>
        o.objectiveId === "switch-direction" ? { ...o, retracted: true } : o,
      ),
    },
    {
      ...horizontal,
      branchOverride: { ...horizontal.branchOverride, move: parse("D8") },
    },
  ])
    assert.deepEqual(route([ready, altered, vertical]), {
      track: "branch",
      options: { replyVariant: "I8" },
    });
});

test("a completed opening build that already demonstrated its switch can continue to defense", () => {
  const ready = built(true);
  assert.ok(ready.achievedObjectives.includes("switch-direction"));
  assert.equal(route([ready]).track, "defend");
});

async function respond(state, searchedMove = "B1") {
  let searches = 0;
  const context = {
    journey: state,
    journeyBusy: false,
    journeyError: null,
    journeyEpoch: 1,
    cpuBusy: false,
    hintBusy: false,
    mode: "learn",
    engine: {
      ready: true,
      pending: null,
      search: async () => {
        searches++;
        return { i: parse(searchedMove) };
      },
    },
    getJourneyView,
    applyJourneyReply,
    render() {},
    saveJourney() {},
    archiveJourney() {},
    se: { play() {} },
    cpuTurn() {},
  };
  await vm.runInNewContext(`${reply}\njourneyReply();`, context);
  return { state: context.journey, searches };
}
test("the reply controller prioritizes eligible teaching moves and falls back to actual CPU for other black choices", async () => {
  const selected = playJourneyMove(
    createJourney("branch", { replyVariant: "E8" }),
    parse("H8"),
  );
  const taught = await respond(selected);
  assert.equal(taught.searches, 0);
  assert.equal(taught.state.moves.at(-1), parse("E8"));
  assert.equal(getJourneyResult(taught.state).branchOverride.variant, "E8");
  const other = await respond(
    playJourneyMove(createJourney("branch"), parse("A1")),
  );
  assert.equal(other.searches, 1);
  assert.equal(other.state.moves.at(-1), parse("B1"));
  assert.equal(getJourneyResult(other.state).branchOverride, null);
  const opening = await respond(
    playJourneyMove(
      createJourney("build", { replyVariant: "H7" }),
      parse("H8"),
    ),
  );
  assert.equal(opening.searches, 0);
  assert.equal(opening.state.moves.at(-1), parse("H7"));
});

test("the branch start action offers its four teaching responses rather than opening variants", () => {
  const choices = [];
  vm.runInNewContext(
    `const start = (el) => {${startAction}}; start({dataset:{track:'branch'}});`,
    {
      journeyTracks,
      esc: (s) => s,
      startJourney() {},
      openModal() {},
      button: (action, title, style, attrs) => {
        choices.push({ action, title, attrs });
        return "";
      },
    },
  );
  assert.equal(choices.length, 4);
  assert.deepEqual(
    choices.map((c) => c.attrs.match(/data-variant='([^']+)'/)[1]),
    ["E8", "H9", "I8", "H5"],
  );
  assert.deepEqual(
    choices.map((c) => c.title.startsWith("横")),
    [true, false, true, false],
  );
});
