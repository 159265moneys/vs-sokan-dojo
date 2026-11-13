import { RECORD_DRILL_WORKER_VERSION, recordSourceHash, verifyRecordDrill } from "./record-drills.js";
import {
  createRecordDrillBank, mergeRecordDrills, selectRecordDrill, pinRecordDrill,
  noteDrillExposure, recordRecordDrillAttempt, noteRecordDrillAnalysis, hasRecordDrillAnalysis,
} from "./record-drill-bank.js";

export const RECORD_DRILL_BANK_KEY = "record-drill-bank-v7";
export const RECORD_DRILL_ATTEMPT_KEY = "record-drill-attempt-v7";
export const RECORD_DRILL_ANALYSIS_KEY = "v7-depth5";
const clone = (value) => JSON.parse(JSON.stringify(value));
const errorText = (error) => error instanceof Error ? error.message : String(error);
const sourceKind = (record) => record.recordOrigin === "import" ? "import" : "own";
const sourceLabel = (kind) => kind === "import" ? "取込棋譜" : "自分の実戦";
const uuid = () => globalThis.crypto?.randomUUID?.() || `drill-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const completeRecord = (record) => record && !record.sourceLessonId && !record.setup &&
  (!record.startPly || record.startPly === 0) &&
  !["lesson", "snapshot", "authored-snapshot", "problem"].includes(record.origin) &&
  (["win", "loss", "draw", "resign", "unfinished"].includes(record.result) || record.archived === true);

/** Event-driven local workers; this class has no DOM, network upload, or timers. */
export class RecordDrillController {
  constructor({ read = (key, fallback) => fallback, save = () => true, onChange = () => {},
    onAssist = () => {}, onExpose = () => {}, workerFactory, fetchSeeds } = {}) {
    this._read = read; this._save = save; this._onChange = onChange;
    this._onAssist = onAssist; this._onExpose = onExpose;
    this._workerFactory = workerFactory || (() => new Worker(new URL("./record-drill-worker.js?v=record-drills-v7", import.meta.url), { type: "module" }));
    this._fetchSeeds = fetchSeeds || (async () => {
      const response = await fetch("./record-drill-seeds-v7.json");
      if (!response.ok) throw Error("収録問題を読み込めません");
      return response.json();
    });
    this.error = ""; this.seedsError = ""; this.busy = false; this.loading = false;
    this.question = null; this.state = null; this.view = null; this.replayFrames = [];
    this.scan = { state: "idle", done: 0, total: 0, queued: 0 };
    this._serial = 0; this._initSerial = 0; this._gradeEpoch = 0;
    this._gradeJob = null; this._scanJob = null; this._scanCurrent = null;
    this._queue = new Map(); this._records = new Map(); this._failed = new Set();
    this._scanError = "";
    this._paused = false; this._scanRunning = false; this._disposed = false;
    this.bank = createRecordDrillBank(this._load(RECORD_DRILL_BANK_KEY, null));
    this._savedAttempt = this._load(RECORD_DRILL_ATTEMPT_KEY, null);
  }

  _load(key, fallback) {
    try { return this._read(key, fallback) ?? fallback; }
    catch { this.error = "保存した練習を読み込めません"; return fallback; }
  }
  _notify() { try { this._onChange(this); } catch {} }
  _write(key, value) {
    try { if (this._save(key, clone(value)) !== false) return true; } catch {}
    this.error = "練習を保存できませんでした";
    return false;
  }
  _saveBank() { return this._write(RECORD_DRILL_BANK_KEY, this.bank); }
  _saveAttempt() {
    if (!this.question || !this.state) return false;
    const snapshot = { version: 7, questionId: this.question.id, sourceHash: this.question.source.recordHash, state: clone(this.state) };
    this._savedAttempt = snapshot;
    return this._write(RECORD_DRILL_ATTEMPT_KEY, snapshot);
  }
  _cancel(slot) {
    const job = this[slot];
    if (!job) return;
    this[slot] = null;
    try { job.worker.terminate(); } catch {}
    job.resolve(null);
  }
  _request(slot, type, payload, onProgress) {
    this._cancel(slot);
    return new Promise((resolve, reject) => {
      let worker;
      try { worker = this._workerFactory(slot === "_scanJob" ? "extract" : "grade"); }
      catch (error) { reject(error); return; }
      const id = `record-drill:${++this._serial}`;
      const job = { worker, id, resolve, reject };
      this[slot] = job;
      const finish = (result, error = null) => {
        if (this[slot] !== job) return;
        this[slot] = null;
        try { worker.terminate(); } catch {}
        if (error) reject(error); else resolve(result);
      };
      worker.onmessage = ({ data }) => {
        if (this[slot] !== job || data?.id !== id) return;
        if (data.version !== RECORD_DRILL_WORKER_VERSION) { finish(null, Error("実戦問題の版が一致しません")); return; }
        if (data.type === "progress") { if (onProgress) onProgress(data); return; }
        if (data.command !== type) return;
        if (data.type === "error") finish(null, Error(data.error || "実戦問題を処理できません"));
        else if (data.type === "result") finish(data);
      };
      worker.onerror = (event) => finish(null, Error(event?.message || "実戦問題を処理できません"));
      worker.onmessageerror = () => finish(null, Error("実戦問題の結果を読み取れません"));
      try { worker.postMessage({ ...clone(payload), id, type, version: RECORD_DRILL_WORKER_VERSION }); }
      catch (error) { finish(null, error); }
    });
  }

  async initialize(records = []) {
    const serial = ++this._initSerial;
    this.loading = true; this.seedsError = ""; this._notify();
    try {
      let seeds = await this._fetchSeeds("./record-drill-seeds-v7.json");
      if (seeds?.json instanceof Function) {
        if (seeds.ok === false) throw Error("収録問題を読み込めません");
        seeds = await seeds.json();
      }
      if (this._disposed || serial !== this._initSerial) return this;
      if (seeds?.version !== 7 || !Array.isArray(seeds.questions)) throw Error("収録問題の形式が一致しません");
      const accepted = seeds.questions.filter((q) => q?.source?.kind === "library" && q.proofPlies >= 5 &&
        verifyRecordDrill(q, seeds.records?.find((record) => record.id === q.source.recordId)));
      if (seeds.questions.length && !accepted.length) throw Error("収録問題を確認できません");
      this.bank = mergeRecordDrills(this.bank, accepted);
      this._saveBank();
    } catch (error) {
      if (!this._disposed && serial === this._initSerial) this.seedsError = errorText(error);
    } finally {
      if (!this._disposed && serial === this._initSerial) {
        this.loading = false;
        this.syncRecords(records);
        if (!this.question && this._savedAttempt) await this.resume();
        this._notify();
      }
    }
    return this;
  }

  choose(options = {}) { return selectRecordDrill(this.bank, options); }

  _gradeResult(result, q, attemptId) {
    const s = result?.state, view = result?.view;
    if (!s || s.version !== 7 || s.questionId !== q.id || s.sourceHash !== q.source.recordHash ||
        s.attemptId !== attemptId || !Array.isArray(s.events) || !Array.isArray(s.board) || s.board.length !== 225 ||
        view?.id !== q.id || !Array.isArray(view.board) || view.board.length !== 225)
      throw Error("実戦問題の結果が一致しません");
    return { state: clone(s), view: clone(view) };
  }
  _history(state, previous = null) {
    const q = this.question, before = previous?.metrics || {}, metrics = state.metrics;
    this.bank = noteDrillExposure(this.bank, q.id, { eventId: `${state.attemptId}:open` });
    for (const [metric, outcome] of [["hints", "hint"], ["answers", "hint"], ["errors", "mistake"], ["unknown", "unknown"], ["retries", "retry"]]) {
      const total = Number.isInteger(metrics?.[metric]) ? Math.min(256, metrics[metric]) : 0;
      for (let n = before[metric] || 0; n < total; n++) this.bank = recordRecordDrillAttempt(this.bank, {
        questionId: q.id, eventId: `${state.attemptId}:${metric}:${n + 1}`, outcome,
      });
    }
    if (state.status === "completed") {
      const eventCount = state.events.findLastIndex((event) => event.type === "play") + 1;
      if (eventCount) this.bank = recordRecordDrillAttempt(this.bank, {
        questionId: q.id, eventId: `${state.attemptId}:success:${eventCount}`, outcome: "success",
      });
    }
  }
  _publish(result, previous = null) {
    this.state = result.state; this.view = result.view;
    this.replayFrames = clone(this.view.explanationFrames || []);
    this._history(this.state, previous);
    this._saveBank(); this._saveAttempt();
  }
  _expose(board) {
    try { this._onExpose([...board], this.question?.moment.skillId || this.question?.moment.patternType || ""); } catch {}
  }

  async start(questionOrId) {
    if (this._disposed) return null;
    const candidate = typeof questionOrId === "string" ? this.bank.questions.find((q) => q.id === questionOrId) : questionOrId;
    if (!verifyRecordDrill(candidate)) { this.error = "実戦問題を確認できません"; this._notify(); return null; }
    const epoch = ++this._gradeEpoch;
    this._cancel("_gradeJob");
    this.bank = mergeRecordDrills(this.bank, [candidate], { activeId: null });
    const q = this.bank.questions.find((item) => item.id === candidate.id);
    if (!q) { this.error = "実戦問題を保持できません"; this._notify(); return null; }
    this.bank = pinRecordDrill(this.bank, q.id);
    this.question = clone(q); this.state = null; this.view = null; this.replayFrames = [];
    this.busy = true; this.error = ""; this._notify();
    const attemptId = uuid();
    try {
      const response = await this._request("_gradeJob", "start", { question: q, options: { attemptId } });
      if (!response || epoch !== this._gradeEpoch || this._disposed) return null;
      this._publish(this._gradeResult(response, q, attemptId));
      this._expose(this.view.board);
      return this.view;
    } catch (error) {
      if (epoch === this._gradeEpoch) this.error = errorText(error);
      return null;
    } finally {
      if (epoch === this._gradeEpoch) { this.busy = false; this._notify(); }
    }
  }

  async command(type, point) {
    if (type === "start") return this.start(point || this.question);
    if (type === "restore") return this.resume();
    if (!["grade", "hint", "answer", "retry", "hide-hints"].includes(type) || this.busy ||
        !this.question || !this.state || this._disposed) return null;
    const epoch = ++this._gradeEpoch, q = this.question, previous = clone(this.state);
    this.busy = true; this.error = ""; this._notify();
    try {
      const response = await this._request("_gradeJob", type, { question: q, state: previous, ...(type === "grade" ? { point } : {}) });
      if (!response || epoch !== this._gradeEpoch || this._disposed) return null;
      this._publish(this._gradeResult(response, q, previous.attemptId), previous);
      const assisted = type === "hint" ? this.state.metrics.hints > previous.metrics.hints :
        type === "answer" && this.state.metrics.answers > previous.metrics.answers;
      if (assisted) {
        try { this._onAssist(type); } catch {}
        this._expose(type === "answer" ? this.replayFrames[0]?.board || this.view.board : this.view.board);
      }
      return this.view;
    } catch (error) {
      if (epoch === this._gradeEpoch) this.error = errorText(error);
      return null;
    } finally {
      if (epoch === this._gradeEpoch) { this.busy = false; this._notify(); }
    }
  }

  async resume() {
    if (this._disposed) return null;
    const saved = this.state ? { version: 7, questionId: this.question.id, sourceHash: this.question.source.recordHash, state: this.state } : this._savedAttempt;
    if (!saved) return null;
    const raw = saved.state || saved;
    const q = this.bank.questions.find((item) => item.id === raw.questionId);
    if ((saved.state && (saved.version !== 7 || saved.questionId !== raw.questionId)) ||
        !q || !verifyRecordDrill(q) || q.source.recordHash !== raw.sourceHash ||
        (saved.sourceHash && saved.sourceHash !== q.source.recordHash)) {
      this.error = "保存した実戦問題を確認できません"; this._notify(); return null;
    }
    const epoch = ++this._gradeEpoch;
    this._cancel("_gradeJob");
    this.busy = true; this.error = ""; this._notify();
    try {
      const restored = await this._request("_gradeJob", "restore", { question: q, state: raw });
      if (!restored || epoch !== this._gradeEpoch || this._disposed) return null;
      const valid = this._gradeResult(restored, q, raw.attemptId);
      const hidden = await this._request("_gradeJob", "hide-hints", { question: q, state: valid.state });
      if (!hidden || epoch !== this._gradeEpoch || this._disposed) return null;
      this.question = clone(q);
      this.bank = pinRecordDrill(this.bank, q.id);
      this._publish(this._gradeResult(hidden, q, raw.attemptId));
      return this.view;
    } catch (error) {
      if (epoch === this._gradeEpoch) this.error = errorText(error);
      return null;
    } finally {
      if (epoch === this._gradeEpoch) { this.busy = false; this._notify(); }
    }
  }

  syncRecords(records = []) {
    if (this._disposed) return;
    const valid = new Map();
    for (const record of Array.isArray(records) ? records : []) {
      if (!completeRecord(record)) continue;
      try {
        const saved = clone(record), recordHash = recordSourceHash(saved);
        if (!saved.moves.length) continue;
        const entry = { recordHash, record: saved, kind: sourceKind(saved) };
        if (!valid.has(recordHash) || entry.kind === "own") valid.set(recordHash, entry);
      } catch {}
    }
    this._records = valid;
    for (const hash of this._queue.keys()) if (!valid.has(hash)) this._queue.delete(hash);
    if (this._scanCurrent && !valid.has(this._scanCurrent.recordHash)) this._cancel("_scanJob");
    this._failed.clear();
    if (this.error === this._scanError) this.error = "";
    this._scanError = "";
    for (const [recordHash, entry] of valid) {
      if (!hasRecordDrillAnalysis(this.bank, { recordHash, analysisKey: RECORD_DRILL_ANALYSIS_KEY }) &&
          this._scanCurrent?.recordHash !== recordHash) this._queue.set(recordHash, entry);
    }
    this.scan.queued = this._queue.size;
    if (this._paused) this.scan.state = "paused";
    this._notify(); this._kickGeneration();
  }
  pauseGeneration() {
    this._paused = true;
    if (this._scanCurrent && this._records.has(this._scanCurrent.recordHash))
      this._queue.set(this._scanCurrent.recordHash, this._records.get(this._scanCurrent.recordHash));
    this._cancel("_scanJob");
    this.scan.state = "paused"; this.scan.queued = this._queue.size; this._notify();
  }
  resumeGeneration() {
    if (this._disposed) return;
    this._paused = false;
    this.scan.state = "idle"; this._notify(); this._kickGeneration();
  }
  _kickGeneration() {
    if (this._paused || this._scanRunning || this._disposed || !this._queue.size) return;
    this._scanRunning = true;
    void this._drainGeneration().finally(() => {
      this._scanRunning = false;
      this.scan.state = this._paused ? "paused" : this._failed.size ? "error" : "idle";
      this.scan.queued = this._queue.size; this._notify();
      if (!this._paused && this._queue.size) this._kickGeneration();
    });
  }
  async _drainGeneration() {
    while (!this._paused && !this._disposed && this._queue.size) {
      const [hash, entry] = this._queue.entries().next().value;
      this._queue.delete(hash);
      if (!this._records.has(hash)) continue;
      this._scanCurrent = entry;
      this.scan = { state: "scanning", done: 0, total: entry.record.moves.length, queued: this._queue.size }; this._notify();
      try {
        const result = await this._request("_scanJob", "extract", { record: entry.record, options: {
          sourceKind: entry.kind, sourceLabel: sourceLabel(entry.kind), sourceId: entry.record.id || hash,
          minStones: 14, minProofPlies: 5, maxQuestions: 4, minPlyGap: 6,
        } }, (progress) => {
          this.scan.done = Number.isFinite(progress.done) ? Math.max(0, Math.min(this.scan.total, progress.done)) : this.scan.done;
          this._notify();
        });
        if (!result || this._paused || !this._records.has(hash) || this._disposed) continue;
        if (!Array.isArray(result.questions) || result.questions.some((q) => !verifyRecordDrill(q, entry.record) ||
            q.source.kind !== entry.kind || q.source.recordHash !== hash || q.proofPlies < 5))
          throw Error("抽出した問題の棋譜が一致しません");
        this.bank = mergeRecordDrills(this.bank, result.questions);
        this.bank = noteRecordDrillAnalysis(this.bank, { recordHash: hash, analysisKey: RECORD_DRILL_ANALYSIS_KEY,
          complete: true, questionCount: result.questions.length, sourceKind: entry.kind, sourceId: entry.record.id || hash });
        this.scan.done = this.scan.total;
        this._saveBank(); this._notify();
      } catch (error) {
        if (!this._paused && this._records.has(hash) && !this._disposed) {
          this._failed.add(hash); this.error = this._scanError = errorText(error); this._notify();
        }
      } finally { this._scanCurrent = null; }
    }
  }
  dispose() {
    this._disposed = true; this._paused = true; this._initSerial++; this._gradeEpoch++;
    this._cancel("_scanJob"); this._cancel("_gradeJob");
    this.busy = false;
  }
}
