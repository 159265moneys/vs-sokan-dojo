import { scanRecord } from "./causal-review.js?v=patterns-20261111-v2";

export async function handleReviewMessage(data, post) {
  if (data?.type !== "scan") return;
  const { id, record } = data;
  try {
    const moments = await scanRecord(record, {
      onProgress: (progress) => post({ type: "progress", id, ...progress }),
    });
    post({ type: "result", id, moments, coverage: moments.coverage });
  } catch (error) {
    post({
      type: "error",
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

if (typeof self !== "undefined" && typeof self.postMessage === "function") {
  self.addEventListener("message", (event) => {
    void handleReviewMessage(event.data, (message) =>
      self.postMessage(message),
    );
  });
}
