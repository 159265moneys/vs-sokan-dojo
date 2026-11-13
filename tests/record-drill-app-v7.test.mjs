import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createRecordDrillBank, mergeRecordDrills, selectRecordDrill, normalizeRecordDrillSkill } from "../dist/record-drill-bank.js";
import { recordDrillFingerprint, startRecordDrill, playRecordDrill, answerRecordDrill, getRecordDrillView } from "../dist/record-drills.js";
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
});
