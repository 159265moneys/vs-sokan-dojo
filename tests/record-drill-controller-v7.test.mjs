import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { handleRecordDrillMessage } from "../dist/record-drill-worker.js";
import { RECORD_DRILL_WORKER_VERSION, recordSourceHash, playRecordDrill, startRecordDrill, retryRecordDrill } from "../dist/record-drills.js";
import { getRecordDrillStats, hasRecordDrillAnalysis } from "../dist/record-drill-bank.js";
import {
  RecordDrillController, RECORD_DRILL_BANK_KEY, RECORD_DRILL_ATTEMPT_KEY, RECORD_DRILL_ANALYSIS_KEY,
} from "../dist/record-drill-controller.js";

const seeds = JSON.parse(fs.readFileSync(new URL("../dist/record-drill-seeds-v7.json", import.meta.url), "utf8"));
const copy = (value) => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
function harness({ memory = new Map(), manualGrade = false, manualExtract = true, seedError = false, failSave = false, fetchSeeds } = {}) {
  const workers = [], assists = [], exposures = [], writes = [];
  let changes = 0;
  const workerFactory = (channel) => {
    let finish;
    const worker = {
      channel, terminated: false, request: null,
      finished: new Promise((resolve) => { finish = resolve; }),
      terminate() { this.terminated = true; },
      postMessage(request) {
        this.request = copy(request);
        if ((channel === "grade" && !manualGrade) || (channel === "extract" && !manualExtract)) {
          queueMicrotask(() => { void this.complete(); });
        }
      },
      send(payload) {
        this.onmessage?.({ data: { id: this.request.id, version: RECORD_DRILL_WORKER_VERSION,
          command: this.request.type, ...copy(payload) } });
      },
      async complete() { await handleRecordDrillMessage(this.request, (data) => this.send(data)); finish(); },
    };
    workers.push(worker);
    return worker;
  };
  const controller = new RecordDrillController({
    read: (key, fallback) => memory.has(key) ? copy(memory.get(key)) : fallback,
    save: (key, value) => { writes.push([key, copy(value)]); if (typeof failSave === "function" ? failSave(key, value) : failSave) return false; memory.set(key, copy(value)); return true; },
    onChange: () => changes++, onAssist: (kind) => assists.push(kind),
    onExpose: (board, skill) => exposures.push({ board, skill }), workerFactory,
    fetchSeeds: fetchSeeds || (async () => { if (seedError) throw Error("seed load failed"); return copy(seeds); }),
  });
  return { controller, workers, memory, assists, exposures, writes, get changes() { return changes; } };
}
const receipt = (record) => ({ recordHash: recordSourceHash(record), analysisKey: RECORD_DRILL_ANALYSIS_KEY });
const unfinished = (record) => ({ ...copy(record), moves: copy(record.moves.slice(0, -2)), result: "unfinished" });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test("a newer record synchronization survives a pending seed fetch", async () => {
  const gate = deferred(), h = harness({ fetchSeeds: () => gate.promise }), c = h.controller;
  const record = { ...unfinished(seeds.records[0]), recordOrigin: "import", id: "qa22-import" };
  const loading = c.initialize([]);
  c.syncRecords([record]);
  const worker = h.workers.at(-1);
  assert.equal(worker.channel, "extract");
  gate.resolve(copy(seeds)); await loading;
  assert.equal(worker.terminated, false);
  assert.equal(c.scan.state, "scanning");
  assert.deepEqual(worker.request.record, record);
  worker.send({ type: "result", questions: [] }); await flush();
  assert(hasRecordDrillAnalysis(c.bank, receipt(record)));
});

test("failed seed loading and a retried fetch cannot clear newer active or queued records", async () => {
  const firstGate = deferred(), retryGate = deferred(), gates = [firstGate, retryGate];
  const h = harness({ fetchSeeds: () => gates.shift().promise }), c = h.controller;
  const firstRecord = unfinished(seeds.records[0]), secondRecord = unfinished(seeds.records[1]);
  const firstLoad = c.initialize([]);
  c.syncRecords([firstRecord]);
  const active = h.workers.at(-1);
  firstGate.reject(Error("seed fetch failed")); await firstLoad;
  assert.equal(active.terminated, false);
  const retryLoad = c.initialize([]);
  c.syncRecords([firstRecord, secondRecord]);
  retryGate.resolve(copy(seeds)); await retryLoad;
  assert.equal(active.terminated, false);
  assert.equal(c.scan.queued, 1);
  active.send({ type: "result", questions: [] }); await flush();
  const queued = h.workers.at(-1);
  assert.deepEqual(queued.request.record, secondRecord);
  queued.send({ type: "result", questions: [] }); await flush();
  assert(hasRecordDrillAnalysis(c.bank, receipt(firstRecord)));
  assert(hasRecordDrillAnalysis(c.bank, receipt(secondRecord)));
});

test("seed loading, fresh start and storage preserve full real boards with a unique attempt", async () => {
  const h = harness(), c = h.controller;
  const before = copy(seeds);
  await c.initialize();
  assert.equal(c.loading, false);
  assert.equal(c.bank.questions.length, seeds.questions.length);
  const q = c.choose();
  await c.start(q.id);
  assert.deepEqual(c.view.board, q.before);
  assert.deepEqual(c.state.moves, q.prefix);
  assert.equal(c.bank.activeId, q.id);
  assert.equal(c.state.status, "ready");
  assert(!("plan" in c.view) && !("moment" in c.view) && !("result" in c.view.source));
  assert.equal(getRecordDrillStats(c.bank, q.id).seen, 1);
  assert.equal(h.exposures.length, 1);
  assert.deepEqual(h.exposures[0].board, q.before);
  assert.equal(h.memory.get(RECORD_DRILL_ATTEMPT_KEY).state.attemptId, c.state.attemptId);
  const firstAttempt = c.state.attemptId;
  await c.start(q);
  assert.notEqual(c.state.attemptId, firstAttempt);
  assert.equal(getRecordDrillStats(c.bank, q.id).seen, 2);
  assert(h.workers.every((worker) => worker.terminated));
  assert.deepEqual(seeds, before);
});

test("a continuing winning line is not success; completion is counted once across repeated commands and refresh", async () => {
  const h = harness(), c = h.controller;
  await c.initialize();
  const q = seeds.questions.find((q) => q.moment.skillId === "order");
  await c.start(q);
  await c.command("grade", q.moment.alternatives[0]);
  assert.equal(c.state.status, "continuing");
  assert.equal(getRecordDrillStats(c.bank, q.id).completed, 0);
  assert.equal(getRecordDrillStats(c.bank, q.id).attempts, 0);
  while (c.state.status === "continuing") await c.command("grade", c.state.plan.line[0]);
  assert.equal(c.state.status, "completed");
  assert.equal(getRecordDrillStats(c.bank, q.id).completed, 1);
  await c.command("grade", 0);
  await c.command("hide-hints");
  assert.equal(getRecordDrillStats(c.bank, q.id).completed, 1);
  const restored = harness({ memory: h.memory }).controller;
  await restored.initialize();
  assert.equal(restored.state.status, "completed");
  assert.equal(getRecordDrillStats(restored.bank, q.id).completed, 1);
  assert.deepEqual(restored.view.qualification, { fullGame: false, independentCurriculum: false });
});

test("hint and answer assistance is retained while refresh and resume close visible clues", async () => {
  const h = harness(), c = h.controller;
  await c.initialize();
  const q = c.choose();
  await c.start(q);
  await c.command("hint");
  assert.equal(c.state.hintStage, 1);
  await c.command("answer");
  assert.equal(c.state.answerShown, true);
  assert(c.replayFrames.length > 0);
  assert.deepEqual(h.assists, ["hint", "answer"]);
  assert.equal(getRecordDrillStats(c.bank, q.id).hints, 2);
  const beforeStats = getRecordDrillStats(c.bank, q.id);
  const restored = harness({ memory: h.memory });
  await restored.controller.initialize();
  const r = restored.controller;
  assert.equal(r.state.hintStage, 0);
  assert.equal(r.state.answerShown, false);
  assert.equal(r.state.metrics.hints, 1);
  assert.equal(r.state.metrics.answers, 1);
  assert.equal(r.state.metrics.assisted, true);
  assert.deepEqual(r.view.highlights, []);
  assert.deepEqual(r.replayFrames, []);
  assert.deepEqual(getRecordDrillStats(r.bank, q.id), beforeStats);
  assert.deepEqual(restored.assists, []);
  await r.resume();
  assert.deepEqual(getRecordDrillStats(r.bank, q.id), beforeStats);
  assert.equal(restored.memory.get(RECORD_DRILL_ATTEMPT_KEY).state.answerShown, false);
});

test("refutations, unknown choices and retries remain distinct history events", async () => {
  const h = harness(), c = h.controller;
  await c.initialize();
  const defense = seeds.questions.find((q) => q.moment.skillId === "defense");
  await c.start(defense);
  await c.command("grade", defense.moment.actual);
  assert.equal(c.state.status, "refuted");
  assert.equal(getRecordDrillStats(c.bank, defense.id).mistakes, 1);
  await c.command("retry");
  assert.equal(c.state.status, "ready");
  assert.equal(getRecordDrillStats(c.bank, defense.id).retries, 1);
  assert.equal(getRecordDrillStats(c.bank, defense.id).mistakes, 1);
  const win = seeds.questions.find((q) => q.moment.skillId === "order");
  const unknown = win.before.findIndex((value, point) => !value && playRecordDrill(win, startRecordDrill(win), point).status === "unknown");
  assert(unknown >= 0);
  await c.start(win);
  await c.command("grade", unknown);
  const stats = getRecordDrillStats(c.bank, win.id);
  assert.equal(c.state.status, "unknown");
  assert.equal(stats.unknown, 1);
  assert.equal(stats.mistakes, 0);
  assert.equal(stats.completed, 0);
});

test("background extraction validates exact original sources, merges own questions and caches only successful analysis", async () => {
  const h = harness({ manualExtract: false }), c = h.controller;
  const record = copy(seeds.records[0]), before = copy(record);
  await c.initialize([record]);
  await h.workers.find((worker) => worker.channel === "extract").finished;
  await flush();
  assert.equal(c.error, "");
  assert(hasRecordDrillAnalysis(c.bank, receipt(record)));
  assert(c.bank.questions.some((q) => q.source.kind === "own" && q.source.recordHash === recordSourceHash(record)));
  const request = h.workers.find((worker) => worker.channel === "extract").request;
  assert.deepEqual(request.record, before);
  assert.deepEqual(request.options, { sourceKind: "own", sourceLabel: "自分の実戦", sourceId: record.id,
    minStones: 14, minProofPlies: 5, maxQuestions: 4, minPlyGap: 6 });
  assert.deepEqual(record, before);
  const workerCount = h.workers.length;
  c.syncRecords([record]); await flush();
  assert.equal(h.workers.length, workerCount);
});

test("pause preserves the queued record, ignores late extraction, and keeps grading independent", async () => {
  const h = harness(), c = h.controller, record = unfinished(seeds.records[0]);
  await c.initialize([record]);
  const firstScan = h.workers.find((worker) => worker.channel === "extract");
  assert(firstScan);
  firstScan.send({ type: "progress", done: 4, total: record.moves.length });
  assert.equal(c.scan.done, 4);
  await c.start(c.choose());
  await c.command("hint");
  assert.equal(c.state.hintStage, 1);
  assert.equal(firstScan.terminated, false);
  c.pauseGeneration();
  assert(firstScan.terminated);
  assert.equal(c.scan.state, "paused");
  assert.equal(c.scan.queued, 1);
  firstScan.send({ type: "result", questions: [] });
  await flush();
  assert(!hasRecordDrillAnalysis(c.bank, receipt(record)));
  c.resumeGeneration(); await flush();
  const scans = h.workers.filter((worker) => worker.channel === "extract");
  assert.equal(scans.length, 2);
  assert.deepEqual(scans[1].request.record, record);
  scans[1].send({ type: "result", questions: [] }); await flush();
  assert(hasRecordDrillAnalysis(c.bank, receipt(record)));
  assert.equal(c.scan.state, "idle");
  assert.equal(c.state.hintStage, 1);
});

test("failed extraction retries only after explicit synchronization and rejected source results never receive a receipt", async () => {
  const h = harness(), c = h.controller, record = unfinished(seeds.records[0]);
  await c.initialize([record]);
  let scan = h.workers.find((worker) => worker.channel === "extract");
  scan.send({ type: "error", error: "worker failed" }); await flush();
  assert.equal(c.scan.state, "error");
  assert(!hasRecordDrillAnalysis(c.bank, receipt(record)));
  assert.equal(h.workers.length, 1);
  c.syncRecords([record]); await flush();
  scan = h.workers.at(-1);
  scan.send({ type: "result", questions: [seeds.questions[1]] }); await flush();
  assert(!hasRecordDrillAnalysis(c.bank, receipt(record)));
  assert(c.error.includes("棋譜"));
  c.syncRecords([record]); await flush();
  h.workers.at(-1).send({ type: "result", questions: [] }); await flush();
  assert(hasRecordDrillAnalysis(c.bank, receipt(record)));
});

test("synchronization rejects lesson snapshots and follows record body changes despite a reused ID", async () => {
  const h = harness(), c = h.controller;
  const old = unfinished(seeds.records[0]);
  const changed = { ...unfinished(seeds.records[1]), id: old.id, recordOrigin: "import" };
  await c.initialize([
    { ...old, sourceLessonId: "lesson" }, { ...old, startPly: 12 }, { ...old, result: null }, old,
  ]);
  const stale = h.workers.find((worker) => worker.channel === "extract");
  assert.equal(h.workers.length, 1);
  c.syncRecords([changed]);
  stale.send({ type: "result", questions: [] }); await flush();
  const current = h.workers.at(-1);
  assert.notEqual(current, stale);
  assert.equal(current.request.options.sourceKind, "import");
  assert.deepEqual(current.request.record.moves, changed.moves);
  current.send({ type: "result", questions: [] }); await flush();
  assert(!hasRecordDrillAnalysis(c.bank, receipt(old)));
  assert(hasRecordDrillAnalysis(c.bank, receipt(changed)));
});

test("starting another question cancels and ignores a late grading result", async () => {
  const h = harness({ manualGrade: true }), c = h.controller;
  await c.initialize();
  const first = c.start(seeds.questions[0]);
  const stale = h.workers.at(-1);
  const second = c.start(seeds.questions[1]);
  const current = h.workers.at(-1);
  assert(stale.terminated);
  await stale.complete();
  await current.complete();
  await Promise.all([first, second]);
  assert.equal(c.question.id, seeds.questions[1].id);
  assert.equal(c.state.questionId, seeds.questions[1].id);
  assert.equal(getRecordDrillStats(c.bank, seeds.questions[0].id).seen, 0);
  assert.equal(getRecordDrillStats(c.bank, seeds.questions[1].id).seen, 1);
  assert.equal(c.busy, false);
});

test("worker response identity and version cannot replace the active attempt", async () => {
  const h = harness({ manualGrade: true }), c = h.controller;
  await c.initialize();
  const pending = c.start(seeds.questions[0]);
  const worker = h.workers.at(-1);
  worker.send({ id: "another-job", type: "result", state: {}, view: {} });
  assert.equal(c.busy, true);
  assert.equal(c.state, null);
  worker.send({ version: "another-version", type: "result", state: {}, view: {} });
  await pending;
  assert.equal(c.busy, false);
  assert.equal(c.state, null);
  assert(c.error.includes("版"));
  assert(!h.memory.has(RECORD_DRILL_ATTEMPT_KEY));
});

test("a successful empty analysis is cached even when the source also has a bundled library question", async () => {
  const h = harness(), c = h.controller, record = copy(seeds.records[0]);
  await c.initialize([record]);
  h.workers.at(-1).send({ type: "result", questions: [] }); await flush();
  assert(hasRecordDrillAnalysis(c.bank, receipt(record)));
  const count = h.workers.length;
  c.syncRecords([record]); await flush();
  assert.equal(h.workers.length, count);
});

test("corrupt saved attempts are rejected without erasing the saved material", async () => {
  const h = harness();
  await h.controller.initialize();
  await h.controller.start(h.controller.choose());
  const damaged = copy(h.memory.get(RECORD_DRILL_ATTEMPT_KEY));
  damaged.state.board[0] = damaged.state.board[0] === 1 ? 2 : 1;
  h.memory.set(RECORD_DRILL_ATTEMPT_KEY, damaged);
  const restored = harness({ memory: h.memory });
  await restored.controller.initialize();
  assert.equal(restored.controller.state, null);
  assert(restored.controller.error);
  assert.deepEqual(h.memory.get(RECORD_DRILL_ATTEMPT_KEY), damaged);
});

test("seed fetch failure leaves cached questions usable and persistence failure remains visible", async () => {
  const original = harness();
  await original.controller.initialize();
  await original.controller.start(original.controller.choose());
  const oldBank = copy(original.memory.get(RECORD_DRILL_BANK_KEY));
  const oldAttempt = copy(original.memory.get(RECORD_DRILL_ATTEMPT_KEY));
  const failed = harness({ memory: original.memory, seedError: true, failSave: true });
  await failed.controller.initialize();
  assert.equal(failed.controller.seedsError, "seed load failed");
  assert(failed.controller.bank.questions.length > 0);
  assert(failed.controller.state);
  await failed.controller.command("hint");
  assert(failed.controller.error.includes("保存"));
  assert.equal(failed.controller.state.hintStage, 1);
  assert.deepEqual(original.memory.get(RECORD_DRILL_BANK_KEY), oldBank);
  assert.deepEqual(original.memory.get(RECORD_DRILL_ATTEMPT_KEY), oldAttempt);
});

test("restore recovers exact missing history after bank writes fail but attempt writes succeed", async () => {
  let failBank = false;
  const h = harness({ failSave: (key) => failBank && key === RECORD_DRILL_BANK_KEY }), c = h.controller;
  await c.initialize();
  const q = seeds.questions.find((item) => item.moment.skillId === "defense");
  await c.start(q);
  failBank = true;
  await c.command("hint");
  await c.command("grade", q.moment.alternatives[0]);
  await c.command("retry");
  assert(c.error.includes("保存"));
  assert.equal(h.memory.get(RECORD_DRILL_BANK_KEY).stats[q.id].completed, 0);
  assert.equal(h.memory.get(RECORD_DRILL_ATTEMPT_KEY).state.status, "ready");
  assert.equal(h.memory.get(RECORD_DRILL_ATTEMPT_KEY).state.metrics.completed, 1);
  const restored = harness({ memory: h.memory }).controller;
  await restored.initialize();
  const stats = getRecordDrillStats(restored.bank, q.id);
  assert.deepEqual([stats.seen, stats.hints, stats.retries, stats.completed, stats.attempts], [1, 1, 1, 1, 1]);
  await restored.resume();
  assert.deepEqual(getRecordDrillStats(restored.bank, q.id), stats);
});

test("cumulative history beyond 512 actions survives event receipt eviction and repeated refresh", async () => {
  const h = harness(), c = h.controller;
  await c.initialize(); await c.start(c.choose()); await c.command("hint");
  let state = copy(c.state);
  for (let i = 0; i < 600; i++) state = retryRecordDrill(c.question, state);
  assert(state.eventOffset > 0);
  h.memory.set(RECORD_DRILL_ATTEMPT_KEY, { version: 7, questionId: c.question.id, sourceHash: c.question.source.recordHash, state });
  const restored = harness({ memory: h.memory }).controller;
  await restored.initialize();
  const stats = getRecordDrillStats(restored.bank, c.question.id);
  assert.deepEqual([stats.seen, stats.hints, stats.retries], [1, 1, 600]);
  const raw = h.memory.get(RECORD_DRILL_BANK_KEY);
  raw.eventIds = Array.from({ length: 700 }, (_, i) => `other-attempt-event-${i}`);
  h.memory.set(RECORD_DRILL_BANK_KEY, raw);
  const again = harness({ memory: h.memory }).controller;
  await again.initialize();
  assert.deepEqual(getRecordDrillStats(again.bank, c.question.id), stats);
  await again.command("retry");
  assert.equal(getRecordDrillStats(again.bank, c.question.id).retries, 601);
});

test("old event receipts migrate to watermarks without reapplying 200 counted retries", async () => {
  const h = harness(), c = h.controller;
  await c.initialize(); await c.start(c.choose());
  let state = copy(c.state);
  for (let i = 0; i < 200; i++) state = retryRecordDrill(c.question, state);
  const oldBank = copy(c.bank), prefix = `${c.question.id}:${state.attemptId}:`;
  delete oldBank.attemptHistory; delete oldBank.activeAttemptKey;
  oldBank.stats[c.question.id].retries = 200;
  oldBank.eventIds = [`${prefix}open`, ...Array.from({ length: 200 }, (_, i) => `${prefix}retries:${i + 1}`)];
  h.memory.set(RECORD_DRILL_BANK_KEY, oldBank);
  h.memory.set(RECORD_DRILL_ATTEMPT_KEY, { version: 7, questionId: c.question.id, sourceHash: c.question.source.recordHash, state });
  const restored = harness({ memory: h.memory }).controller;
  await restored.initialize();
  assert.deepEqual(getRecordDrillStats(restored.bank, c.question.id), oldBank.stats[c.question.id]);
  assert.equal(Object.values(restored.bank.attemptHistory)[0].retries, 200);
});
