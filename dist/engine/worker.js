let engine,
  active = null;
function output(line) {
  if (line.startsWith("INFO ") && active) {
    const [, key, ...tail] = line.split(" ");
    const value = tail.join(" ");
    if (
      ["DEPTH", "NODES", "TOTALTIME", "EVAL", "WINRATE", "BESTLINE"].includes(
        key,
      )
    ) {
      active.info[key] = value;
      self.postMessage({ type: "info", id: active.id, key, value });
    }
  }
  if (/^\d+,\d+$/.test(line) && active) {
    const [x, y] = line.split(",").map(Number);
    self.postMessage({
      type: "result",
      id: active.id,
      i: y * 15 + x,
      info: active.info,
    });
    active = null;
  }
  if (line.startsWith("ERROR"))
    self.postMessage({ type: "error", id: active?.id, message: line });
}
async function init() {
  try {
    self.postMessage({ type: "status", text: "読み込み中" });
    const sizes = [16000000, 16000000, 8306406];
    const total = sizes.reduce((a, b) => a + b, 0);
    let loaded = 0,
      lastPercent = -1;
    const report = (bytes) => {
      loaded += bytes;
      const percent = Math.min(100, Math.floor((loaded / total) * 100));
      if (percent !== lastPercent) {
        lastPercent = percent;
        self.postMessage({
          type: "progress",
          loaded,
          total,
          percent,
          stage: "download",
        });
      }
    };
    const chunks = await Promise.all(
      [0, 1, 2].map(async (i) => {
        const r = await fetch(`weights-${i}.bin`);
        if (!r.ok) throw Error("読み込みに失敗しました");
        if (!r.body) {
          const bytes = new Uint8Array(await r.arrayBuffer());
          if (bytes.length !== sizes[i]) throw Error("データを読み込めません");
          report(bytes.length);
          return bytes;
        }
        const bytes = new Uint8Array(sizes[i]);
        let offset = 0;
        const reader = r.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (offset + value.length > bytes.length)
            throw Error("データを読み込めません");
          bytes.set(value, offset);
          offset += value.length;
          report(value.length);
        }
        if (offset !== sizes[i]) throw Error("データを読み込めません");
        return bytes;
      }),
    );
    self.postMessage({
      type: "progress",
      loaded,
      total,
      percent: 100,
      stage: "initialize",
    });
    const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.length;
    }
    importScripts("rapfi-single-simd128.js");
    engine = await self.Rapfi({
      locateFile: (name) => new URL(name, self.location.href).href,
      getPreloadedPackage: () => bytes.buffer,
      onReceiveStdout: output,
      onReceiveStderr: (text) => self.postMessage({ type: "stderr", text }),
      onAbort: () =>
        self.postMessage({
          type: "error",
          message: "エンジンを起動できません",
        }),
    });
    engine.sendCommand("START 15");
    engine.sendCommand("INFO RULE 0");
    engine.sendCommand("INFO THREAD_NUM 1");
    engine.sendCommand("INFO HASH_SIZE 65536");
    engine.sendCommand("INFO PONDERING 0");
    engine.sendCommand("INFO SHOW_DETAIL 3");
    engine.sendCommand("INFO SWAPABLE 0");
    self.postMessage({ type: "ready" });
  } catch (e) {
    self.postMessage({ type: "error", message: e.message });
  }
}
self.onmessage = ({ data }) => {
  if (data.type === "init") {
    init();
    return;
  }
  if (data.type !== "search" || !engine) return;
  active = { id: data.id, info: {} };
  const c = (data.moves.length % 2) + 1;
  engine.sendCommand("INFO STRENGTH " + data.strength);
  engine.sendCommand("INFO MAX_DEPTH 100");
  engine.sendCommand("INFO MAX_NODE 0");
  engine.sendCommand("INFO TIMEOUT_TURN " + data.ms);
  engine.sendCommand("INFO TIMEOUT_MATCH 100000000");
  engine.sendCommand("INFO TIME_LEFT 100000000");
  engine.sendCommand(
    "YXBOARD " +
      data.moves
        .map(
          (m, j) =>
            `${m % 15},${Math.floor(m / 15)},${(j % 2) + 1 === c ? 1 : 2}`,
        )
        .join(" ") +
      " DONE",
  );
  engine.sendCommand("YXNBEST 1");
};
