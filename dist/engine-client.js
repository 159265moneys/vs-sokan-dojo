export class Engine {
  constructor(onStatus = () => {}, onInfo = () => {}, onProgress = () => {}) {
    this.onStatus = onStatus;
    this.onInfo = onInfo;
    this.onProgress = onProgress;
    this.seq = 0;
    this.pending = null;
    this.start();
  }
  start() {
    this.ready = false;
    this.onStatus("loading");
    this.worker = new Worker(new URL("./engine/worker.js", import.meta.url));
    this.worker.onmessage = ({ data: d }) => {
      if (d.type === "progress") this.onProgress(d);
      if (d.type === "ready") {
        clearTimeout(this.bootTimer);
        this.ready = true;
        this.onStatus("ready");
      }
      if (d.type === "info" && this.pending?.id === d.id) this.onInfo(d);
      if (d.type === "result" && this.pending?.id === d.id) {
        const p = this.pending;
        this.pending = null;
        clearTimeout(p.timer);
        p.resolve(d);
      }
      if (d.type === "error") this.fail(d.message);
    };
    this.worker.onerror = () => this.fail("Rapfiを起動できません");
    this.worker.postMessage({ type: "init" });
    this.bootTimer = setTimeout(
      () => this.fail("読み込みがタイムアウトしました"),
      90000,
    );
  }
  search(moves, { ms = 1500, strength = 100 } = {}) {
    if (!this.ready) return Promise.reject(Error("エンジン準備中"));
    if (this.pending) return Promise.reject(Error("解析中です"));
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending = {
        id,
        resolve,
        reject,
        timer: setTimeout(
          () => this.fail("解析がタイムアウトしました"),
          ms + 20000,
        ),
      };
      this.worker.postMessage({
        type: "search",
        id,
        moves: moves.map((m) => (typeof m === "number" ? m : m.i)),
        ms,
        strength,
      });
    });
  }
  fail(message) {
    clearTimeout(this.bootTimer);
    this.ready = false;
    this.worker?.terminate();
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(Error(message));
      this.pending = null;
    }
    this.onStatus("error", message);
  }
  cancel() {
    clearTimeout(this.bootTimer);
    this.worker?.terminate();
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(Error("cancelled"));
      this.pending = null;
    }
    this.start();
  }
}
