import { coord, winningLine } from "./game.js";
import { stoneName } from "./board-themes.js";
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
export function initBoard() {
  let svg = "",
    grid = "";
  for (let j = 0; j < 15; j++) {
    const p = 40 + j * 40;
    grid += `<path d="M40 ${p}H600 M${p} 40V600" fill="none" stroke="#706d4e" stroke-width=".8"/>`;
    svg += `<text x="${p}" y="18" text-anchor="middle">${String.fromCharCode(65 + j)}</text><text class="row-coordinate" x="11" y="${p + 5}" text-anchor="middle">${15 - j}</text><text x="${p}" y="634" text-anchor="middle">${String.fromCharCode(65 + j)}</text><text class="row-coordinate" x="629" y="${p + 5}" text-anchor="middle">${15 - j}</text>`;
  }
  for (const [x, y] of [
    [3, 3],
    [11, 3],
    [7, 7],
    [3, 11],
    [11, 11],
  ])
    svg += `<circle cx="${40 + x * 40}" cy="${40 + y * 40}" r="3" fill="#626443"/>`;
  $("#board-lines").innerHTML =
    `<defs><linearGradient id="inferno-grid-heat" x1="40" y1="40" x2="600" y2="600" gradientUnits="userSpaceOnUse"><stop stop-color="#4a1e21"/><stop offset=".23" stop-color="#70332a"/><stop offset=".43" stop-color="#a24b37"/><stop offset=".57" stop-color="#512126"/><stop offset=".8" stop-color="#893d30"/><stop offset="1" stop-color="#421a20"/></linearGradient><filter id="inferno-grid-glow" x="0" y="0" width="640" height="640" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="1.8"/></filter></defs><g class="grid-bloom" filter="url(#inferno-grid-glow)">${grid}</g><g class="grid-lines">${grid}</g><g class="grid-heat" stroke="url(#inferno-grid-heat)">${grid}</g>${svg}`;
  $("#intersections").innerHTML = Array.from(
    { length: 15 },
    (_, row) =>
      `<div role="row" class="board-row" aria-rowindex="${row + 1}">${Array.from(
        { length: 15 },
        (_, col) => {
          const i = row * 15 + col;
          return `<button class="intersection" data-cell="${i}" role="gridcell" aria-rowindex="${row + 1}" aria-colindex="${col + 1}" aria-selected="false" aria-label="${coord(i)} 空点" tabindex="${i === 112 ? 0 : -1}"></button>`;
        },
      ).join("")}</div>`,
  ).join("");
}

const xy = (i) => [40 + (i % 15) * 40, 40 + Math.floor(i / 15) * 40];
export function renderBoard(
  frame,
  { skin = "classic", numbers = false, pending = null, previewSide = 1 } = {},
) {
  const board = frame.board,
    history = frame.history || [];
  const order = new Map(history.map((m, j) => [m.i, j + 1]));
  $("#board").setAttribute(
    "aria-label",
    skin === "inferno"
      ? "15×15の五目盤。赤があなた、青が相手"
      : "15×15の五目盤。黒があなた、白が相手",
  );
  $$("[data-cell]").forEach((el, i) => {
    const c = board[i],
      preview = pending === i && !c;
    el.className = `intersection ${c ? "occupied" : ""} ${preview ? "preview" : ""} ${i === frame.last ? "last" : ""} ${numbers ? "numbered" : ""}`;
    el.setAttribute(
      "aria-label",
      `${coord(i)} ${c ? stoneName(skin, c) : "空点"}${i === frame.last ? " 最新手" : ""}${preview ? " 選択中" : ""}`,
    );
    el.setAttribute("aria-selected", String(preview));
    const signature = `${c}:${preview}:${numbers ? order.get(i) || "" : ""}:${previewSide}`;
    if (el.dataset.render === signature) return;
    const previous = el.dataset.stone;
    el.dataset.render = signature;
    el.dataset.stone = String(c);
    el.innerHTML =
      c || preview
        ? `<span class="stone ${(c || previewSide) === 2 ? "white" : "black"} ${previous !== String(c) ? "new" : ""}">${numbers ? order.get(i) || "" : ""}</span>`
        : "";
  });
  let overlay = "";
  const markedPoints = new Set();
  for (const group of frame.highlights || []) {
    const tone = ["focus", "danger", "good"].includes(group.tone)
      ? group.tone
      : "focus";
    for (const i of group.cells || []) {
      if (!board[i]) continue;
      const [x, y] = xy(i);
      overlay += `<circle class="shape-ring ${tone}" cx="${x}" cy="${y}" r="20"/>`;
    }
    (group.points || []).forEach((i, j) => {
      if (board[i] || markedPoints.has(i)) return;
      const label = String.fromCharCode(65 + markedPoints.size);
      markedPoints.add(i);
      const [x, y] = xy(i);
      overlay += `<circle class="shape-point ${tone}" cx="${x}" cy="${y}" r="15"/><text class="shape-letter" x="${x}" y="${y + 6}" text-anchor="middle">${label}</text>`;
    });
  }
  const line =
    frame.last != null ? winningLine(Uint8Array.from(board), frame.last) : [];
  if (line.length)
    overlay += `<polyline class="winning-line" points="${line
      .sort((a, b) => a - b)
      .map((i) => xy(i).join(","))
      .join(" ")}"/>`;
  $("#board-overlay").innerHTML = overlay;
  const marks = (frame.highlights || []).flatMap((g) => [
    ...g.cells,
    ...g.points,
  ]);
  for (const i of new Set(marks)) {
    const el = $(`[data-cell="${i}"]`);
    el?.setAttribute(
      "aria-label",
      `${el.getAttribute("aria-label")} 注目する${board[i] ? "石" : "点"}`,
    );
  }
}
