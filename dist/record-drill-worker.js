import {
  RECORD_DRILL_WORKER_VERSION, extractRecordDrills, startRecordDrill, playRecordDrill,
  hintRecordDrill, answerRecordDrill, hideRecordDrillHints, retryRecordDrill, restoreRecordDrill, getRecordDrillView,
} from "./record-drills.js?v=record-drills-v7";

export async function handleRecordDrillMessage(data, post) {
  if (!data || !["extract", "grade", "hint", "answer", "hide-hints", "retry", "restore", "start"].includes(data.type)) return;
  const { id, type } = data;
  const send = (payload) => post({ id, version: RECORD_DRILL_WORKER_VERSION, ...payload });
  try {
    if (data.version && data.version !== RECORD_DRILL_WORKER_VERSION) throw Error("実戦問題の版が一致しません");
    if (type === "extract") {
      const questions = await extractRecordDrills(data.record, {
        ...data.options, onProgress: (progress) => send({ type: "progress", ...progress }),
      });
      send({ type: "result", command: type, questions: [...questions], coverage: questions.coverage });
      return;
    }
    const q = data.question;
    const state = type === "start" ? startRecordDrill(q, data.options) :
      type === "grade" ? playRecordDrill(q, data.state, data.point) :
      type === "hint" ? hintRecordDrill(q, data.state) :
      type === "answer" ? answerRecordDrill(q, data.state) :
      type === "hide-hints" ? hideRecordDrillHints(q, data.state) :
      type === "retry" ? retryRecordDrill(q, data.state) : restoreRecordDrill(q, data.state);
    if (!state) throw Error("保存された試行を復元できません");
    send({ type: "result", command: type, state, view: getRecordDrillView(q, state) });
  } catch (error) {
    send({ type: "error", command: type, error: error instanceof Error ? error.message : String(error) });
  }
}
if (typeof self !== "undefined" && typeof self.postMessage === "function") {
  self.addEventListener("message", (event) => void handleRecordDrillMessage(event.data, (message) => self.postMessage(message)));
}
