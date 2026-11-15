import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createRecordDrillBank, mergeRecordDrills, selectRecordDrill, normalizeRecordDrillSkill } from "../dist/record-drill-bank.js";
import { recordDrillFingerprint, startRecordDrill, playRecordDrill, answerRecordDrill, hideRecordDrillHints, getRecordDrillView } from "../dist/record-drills.js";
import { createJourney, playJourneyMove, getJourneyResult } from "../dist/journey.js";

const app = readFileSync(new URL("../dist/app.js", import.meta.url), "utf8");
const seed = JSON.parse(readFileSync(new URL("../dist/record-drill-seeds-v7.json", import.meta.url), "utf8"));
const functionStart = (name) => {
  const n = app.indexOf(`function ${name}(`);
  return app.slice(n - 6, n) === "async " ? n - 6 : n;
};
const source = (name, next) => app.slice(functionStart(name), functionStart(next));
const button = (action, label) => `<button data-action="${action}">${label}</button>`;

test("real-game question library does not disclose source outcome, tactic, or solution coordinates", () => {
  const bank = mergeRecordDrills(createRecordDrillBank(), seed.questions);
  const ctx = vm.createContext({ recordDrills: { bank, scan: { state: "idle" } }, button,
    icon: () => "", esc: String });
  vm.runInContext(source("renderRecordDrillLibrary", "renderLibrary") + "\nhtml = renderRecordDrillLibrary();", ctx);
  assert.match(ctx.html, /収録棋譜/);
  assert.doesNotMatch(ctx.html, /勝ち筋|四三|四追い|達四|両端四|勝ち|負け|次の二重/);
  assert.doesNotMatch(ctx.html, /\b[A-O](?:1[0-5]|[1-9])\b/);
  assert(!ctx.html.includes("data-problem="), "fixed lesson cards are not substituted into real-game practice");
});

test("the initial app frame is the entire original board without a tactical overlay", () => {
  const q = seed.questions.find((q) => q.before.filter(Boolean).length >= 30);
  const state = startRecordDrill(q), view = getRecordDrillView(q, state);
  const ctx = vm.createContext({ recordDrillLoadingQuestion: null, recordDrillEntering: false,
    recordDrillFrame: null, recordDrills: { question: q, state, view }, emptyFrame: () => ({ board: [] }) });
  vm.runInContext(source("currentRecordDrillFrame", "openRecordDrillLibrary") + "\nframe = currentRecordDrillFrame();", ctx);
  assert.deepEqual(Array.from(ctx.frame.board), q.before);
  assert.deepEqual(Array.from(ctx.frame.highlights), []);
  assert.equal(ctx.frame.history.length, q.ply - 1);
});

test("related practice selects a different whole recorded position and cannot fall back to the basic unit", async () => {
  const q = seed.questions.find((q) => q.moment.skillId === "defense");
  const bank = mergeRecordDrills(createRecordDrillBank(), seed.questions);
  const start = app.indexOf('"review-related": async () => {');
  const end = app.indexOf('\n  "precise-pick":', start);
  const handler = app.slice(start, end).replace('"review-related": ', "handler = ").replace(/,\s*$/, "");
  const ctx = vm.createContext({ reviewScreen: "moment", moments: [{ ...q.moment, before: q.before }], momentIndex: 0,
    recordDrillSelection: null, recordDrillRound: [q.id], normalizeRecordDrillSkill, recordDrillFingerprint,
    closeModal: () => {}, openRecordDrillLibrary: () => {},
    openUnit: () => { throw Error("basic-pattern fallback"); },
    getFrame: () => { throw Error("the reviewed decision supplies its own board and skill"); },
  });
  ctx.nextRecordDrill = () => { ctx.selected = selectRecordDrill(bank, ctx.recordDrillSelection); };
  vm.runInContext(handler, ctx);
  await ctx.handler();
  assert(ctx.selected);
  assert.notEqual(ctx.selected.fingerprint, q.fingerprint);
  assert.equal(ctx.selected.moment.skillId, q.moment.skillId);
  assert(ctx.selected.before.filter(Boolean).length >= 14);
});

test("continuing a defensive question keeps the authentic prefix and is not an empty-board match", () => {
  const q = seed.questions.find((q) => q.moment.scope === "line-prevented");
  const state = playRecordDrill(q, startRecordDrill(q), q.moment.alternatives[0]);
  assert.equal(state.result, "line-prevented");
  let result;
  const ctx = vm.createContext({ recordDrills: { question: q, state },
    levels: { normal: { ms: 300, strength: 35 }, strong: { ms: 1800, strength: 85 }, max: { ms: 8000, strength: 100 } },
    startJourney: (track, options) => {
      let s = createJourney(track, { ...options, attemptId: "record-drill-transfer" });
      s = playJourneyMove(s, options.initialBlackMove);
      result = getJourneyResult(s);
    },
  });
  vm.runInContext(source("continueRecordDrill", "renderRecordDrillLibrary") + "\ncontinueRecordDrill();", ctx);
  assert.equal(result.startPly, q.prefix.length);
  assert.deepEqual(result.moves.slice(0, q.prefix.length), q.prefix);
  assert.equal(result.moves[q.prefix.length], state.moves[q.prefix.length]);
  assert.equal(result.fromOpening, false);
});

test("finished-game source collection excludes the active game and authored setup boards", () => {
  const good = { ...seed.records[0], id: "actual", moves: seed.records[0].moves };
  const ctx = vm.createContext({ records: [good, { ...good, id: "active" },
    { ...good, id: "snapshot", startPly: 14 }, { ...good, id: "lesson", sourceLessonId: "x" }],
    practiceGames: [{ ...good, id: "guided", startPly: 0 }, { ...good, id: "recovery", startBoard: [1] },
      { ...good, id: "malformed-start", startBoard: {} }],
    game: { id: "active", result: null } });
  vm.runInContext(source("recordDrillSources", "refreshRecordDrills") + "\nselected = recordDrillSources();", ctx);
  assert.deepEqual(Array.from(ctx.selected, (r) => r.id), ["actual", "guided"]);
});

test("late problem loading cannot replace a newer selected question or reopen a departed screen", async () => {
  const [a, b] = seed.questions;
  const waiting = new Map();
  const ctx = vm.createContext({ recordDrills: { start: (q) => new Promise((resolve) => waiting.set(q.id, resolve)), view: null },
    recordDrillNavigation: 0, recordDrillRound: [], recordDrillSelection: null,
    mode: "learn", learnSection: "mixed", learnScreen: "library", lessonReplay: null,
    recordDrillFrame: null, recordDrillEntering: false, recordDrillLoadingQuestion: null,
    pending: { learn: null }, save: () => {}, saveRecordDrillRoute: () => {}, render: () => {},
    refreshRecordDrills: () => {},
  });
  vm.runInContext(source("openRecordDrillLibrary", "openRecordDrill") + source("openRecordDrill", "resumeRecordDrill"), ctx);
  const first = ctx.openRecordDrill(a), second = ctx.openRecordDrill(b);
  waiting.get(a.id)(null); await first;
  assert.equal(ctx.recordDrillLoadingQuestion.id, b.id);
  assert.equal(ctx.recordDrillEntering, true);
  ctx.openRecordDrillLibrary();
  waiting.get(b.id)(null); await second;
  assert.equal(ctx.learnScreen, "library");
  assert.equal(ctx.recordDrillEntering, false);
});

test("a completed puzzle explains the original decisive move rather than only its final five", async () => {
  const q = seed.questions.find((q) => q.moment.scope === "forced-win");
  let state = startRecordDrill(q);
  state = playRecordDrill(q, state, q.moment.alternatives[0]);
  while (state.status === "continuing") state = playRecordDrill(q, state, state.plan.line[0]);
  assert.equal(state.status, "completed");
  const controller = { question: q, state, view: getRecordDrillView(q, state), busy: false,
    async command(type) {
      assert.equal(type, "answer");
      this.state = answerRecordDrill(q, this.state);
      this.view = getRecordDrillView(q, this.state);
    },
  };
  const ctx = vm.createContext({ recordDrills: controller, recordDrillNavigation: 0,
    recordDrillFrame: null, recordDrillReplayFrames: [], learnScreen: "record-drill",
    markLiveHelp: () => {}, render: () => {} });
  vm.runInContext(source("explainRecordDrill", "continueRecordDrill"), ctx);
  await ctx.explainRecordDrill();
  assert.equal(ctx.recordDrillFrame, 0);
  assert.equal(ctx.recordDrillReplayFrames[0].board.filter(Boolean).length, q.ply);
  assert.equal(ctx.recordDrillReplayFrames[0].board[state.moves[q.prefix.length]], 1);
});

test("finishing a real game automatically queues the saved full record for local extraction", () => {
  const original = seed.records.find((r) => r.result === "loss");
  let queued = null, resumed = false;
  const ctx = vm.createContext({ game: { ...structuredClone(original), result: null }, records: [], practiceGames: [],
    recordDrills: { syncRecords: (records) => { queued = records; }, resumeGeneration: () => { resumed = true; } },
    structuredClone, recordGameEvidence: () => {}, save: () => true, saveGame: () => {},
    archivePending: false, se: { play: () => {} }, mode: "play", render: () => {}, toast: () => {},
  });
  vm.runInContext(source("recordDrillSources", "saveRecordDrillRoute") + source("finish", "putGame") + "\nfinish('loss');", ctx);
  assert(resumed);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].result, "loss");
  assert.deepEqual(queued[0].moves, original.moves);
});

test("a real-drill hint does not mark a future empty match assisted, but marks an ongoing match", () => {
  const writes = [];
  const ctx = vm.createContext({
    RecordDrillController: class { constructor(options) { this.options = options; } },
    read: () => null, save: () => {}, exposeRecordDrillBoard: () => {},
    learningRole: "lesson", learning: null, journey: null, playTrace: null,
    mode: "learn", learnScreen: "record-drill", recordDrillEntering: false,
    game: { moves: [], result: null, assisted: false },
    saveGame: () => writes.push("save"), recordGameEvidence: () => writes.push("evidence"),
  });
  const start = app.indexOf("recordDrills = new RecordDrillController({");
  const end = app.indexOf("recordDrillReady = recordDrills.initialize", start);
  vm.runInContext(source("markLiveHelp", "exposeLesson") + app.slice(start, end), ctx);
  ctx.recordDrills.options.onAssist("hint");
  assert.equal(ctx.game.assisted, false);
  assert.deepEqual(writes, []);
  ctx.game.moves.push({ i: 112 });
  ctx.recordDrills.options.onAssist("hint");
  assert.equal(ctx.game.assisted, true);
  assert.deepEqual(writes, ["save", "evidence"]);
  ctx.mode = "play";
  ctx.game.assisted = false;
  ctx.recordDrills.options.onAssist("hint");
  assert.equal(ctx.game.assisted, false, "an unseen late answer must not taint a different active match");
  assert.deepEqual(writes, ["save", "evidence"]);
});

test("returning while an answer is still loading hides that late answer before the resumed board is rendered", async () => {
  const q = seed.questions[0], initial = startRecordDrill(q);
  let resumes = 0;
  const frames = [];
  const controller = {
    question: q, state: initial, view: getRecordDrillView(q, initial), busy: true,
    async resume() {
      resumes++;
      this.state = hideRecordDrillHints(q, this.state);
      this.view = getRecordDrillView(q, this.state);
      return this.view;
    },
  };
  const ctx = vm.createContext({
    RecordDrillController: class { constructor(options) { controller.options = options; return controller; } },
    read: () => null, save: () => {}, onAssist: () => {}, exposeRecordDrillBoard: () => {},
    mode: "learn", learnScreen: "record-drill", learnSection: "mixed",
    recordDrillNavigation: 0, recordDrillEntering: false, recordDrillHideOnReturn: false,
    recordDrillLoadingQuestion: null, recordDrillLoadingFrame: null, recordDrillFrame: null,
    recordDrillReplayFrames: [], pending: { learn: null },
    saveRecordDrillRoute: () => {}, emptyFrame: () => ({ board: [], highlights: [] }),
    render: () => frames.push(ctx.currentRecordDrillFrame()),
  });
  const start = app.indexOf("recordDrills = new RecordDrillController({");
  const end = app.indexOf("recordDrillReady = recordDrills.initialize", start);
  vm.runInContext(source("currentRecordDrillFrame", "openRecordDrillLibrary") +
    source("resumeRecordDrill", "nextRecordDrill") + app.slice(start, end), ctx);
  await ctx.resumeRecordDrill();
  assert.equal(resumes, 0);
  assert.equal(ctx.recordDrillHideOnReturn, true);
  controller.state = answerRecordDrill(q, initial);
  controller.view = getRecordDrillView(q, controller.state);
  assert(controller.view.highlights.some((mark) => mark.points.length));
  controller.busy = false;
  controller.options.onChange();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resumes, 1);
  assert.equal(ctx.recordDrillEntering, false);
  assert.equal(controller.state.metrics.answers, 1);
  assert.equal(controller.state.answerShown, false);
  assert(frames.length > 0 && frames.every((frame) => frame.highlights.length === 0));
  assert(frames.every((frame) => JSON.stringify(frame.board) === JSON.stringify(q.before)));
});

for (const entry of ["new", "history", "tab"])
  test(`background extraction stays paused when an active journey is entered by ${entry}`, () => {
    let paused = false;
    const active = { id: "active", completed: false, moves: [], startPly: 0 };
    const ctx = vm.createContext({
      recordDrills: { pauseGeneration: () => { paused = true; } },
      journey: { id: "old", completed: true, moves: [1, 2], startPly: 0 },
      practiceGames: [{ id: "resume", snapshot: {} }],
      recoverJourney: () => active,
      createJourney: () => active,
      archiveJourney: (options) => { if (options?.generate !== false) paused = false; },
      journeyBusy: false, journeyEpoch: 0, journeyError: null, journeyHelpKey: null, engine: null,
      pending: { learn: null }, crypto: { randomUUID: () => "new" },
      mode: "guide", learnScreen: "journey", learnSection: "games", lessonReplay: null,
      markLiveHelp: () => {}, closeModal: () => {}, save: () => {}, saveJourney: () => {}, render: () => {},
      journeyReply: () => { assert(paused, "CPU play must not restart extraction while archiving an older game"); },
      saveStrategyScroll: () => {}, reviewScan: { state: "idle" },
    });
    if (entry === "new") vm.runInContext(source("startJourney", "resumePractice") + "\nstartJourney('build');", ctx);
    if (entry === "history") vm.runInContext(source("resumePractice", "startRecovery") + "\nresumePractice('resume');", ctx);
    if (entry === "tab") {
      ctx.journey = active;
      vm.runInContext(source("switchMode", "statusText") + "\nswitchMode('learn');", ctx);
    }
    assert(paused);
  });

test("an old fixed mixed-practice save opens the real-game bank without deleting the old attempt", () => {
  const block = app.slice(app.indexOf('const savedRecordDrillRoute = read('), app.indexOf('const emptyFrame ='));
  for (const section of ["mixed", "lessons"]) {
    const learning = { problemId: "three-room", status: "choose", history: [{ i: 118, side: 1 }], hints: { uses: 2 } };
    const ctx = vm.createContext({ read: () => null, learning, learnScreen: "practice", learnSection: section,
      recordDrillRound: [], recordDrillSelection: null });
    vm.runInContext(block, ctx);
    assert.equal(ctx.learning, learning);
    assert.equal(ctx.learnScreen, section === "mixed" ? "library" : "practice");
    assert.equal(ctx.learnSection, section);
    assert.equal(learning.history.length, 1);
    assert.equal(learning.hints.uses, 2);
  }
});

test("resuming that retained basic question persists its explicit basic-learning destination", () => {
  const start = app.indexOf('"learn-resume": () => {'), end = app.indexOf('\n  "mixed-start":', start);
  const handler = app.slice(start, end).replace('"learn-resume": ', 'handler = ').replace(/,\s*$/, '');
  const saves = [], learning = { problemId: "three-room", status: "choose" };
  const ctx = vm.createContext({ learning, learnScreen: "library", learnSection: "lessons", lessonReplay: {},
    save: (key, value) => saves.push([key, value]),
    saveLearning: () => saves.push(["learning-route", ctx.learnSection]), render: () => {},
  });
  vm.runInContext(handler + '\nhandler();', ctx);
  assert.equal(ctx.learning, learning);
  assert.equal(ctx.learnScreen, "practice");
  assert.deepEqual(saves, [["record-drill-route-v7", null], ["learning-route", "lessons"]]);
});
