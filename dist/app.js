import {
  boardFrom,
  winningLine,
  winningMoves,
  winner,
  coord,
  classify,
  validateRecord,
} from "./game.js";
import { trainingLessons as lessons, lessonBoard } from "./lessons.js";
import {
  makeTrainingPosition,
  createTrainingState as createPositionState,
  judgeTrainingMove,
  createTacticalPosition,
} from "./training-positions.js";
import {
  createTrainingState as hydrateTraining,
  recordTrainingAttempt,
  getThemeStats,
  chooseNextTheme,
  startTrainingSession,
  getSessionSummary,
  enqueueTacticalMistake,
  getTacticalMistake,
  removeTacticalMistake,
} from "./training-progress.js";
import { Engine } from "./engine-client.js";
import { boardSkin, stoneSprite, stoneName, skinText } from "./board-themes.js";
import { Sounds } from "./sound.js";
import {
  makeMatePuzzle,
  createMateState,
  judgeMateMove,
} from "./mate-puzzles.js";
import { annotateMove } from "./expert-guidance.js";
import { practiceSnapshot, restorePractice } from "./training-persistence.js";
const icon = (name) =>
  `<svg class="ui-icon" aria-hidden="true"><use href="assets/ui-icons.svg#${name}"/></svg>`;
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const levels = {
  normal: { label: "普通", ms: 300, strength: 35 },
  strong: { label: "強い", ms: 1800, strength: 85 },
  max: { label: "最強", ms: 8000, strength: 100 },
};
function read(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem("sokan." + key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function write(key, value) {
  try {
    localStorage.setItem("sokan." + key, JSON.stringify(value));
    return true;
  } catch {
    toast("保存できませんでした。棋譜を書き出してください");
    return false;
  }
}
const storedRecords = read("records", []);
const recoveredTraining = restorePractice(read("training-v1", null));
let records = Array.isArray(storedRecords)
    ? storedRecords.filter((r) => r && Array.isArray(r.moves))
    : [],
  training = recoveredTraining.state,
  mode = "play",
  level = read("level", "strong"),
  assist = false,
  numbers = read("numbers", false),
  sound = read("sound", true),
  engineState = "loading",
  busy = false,
  epoch = 0,
  thinkingDepth = 0;
if (!levels[level]) level = "strong";
const se = new Sounds();
se.enabled = sound;
let titleVisible = true;
let expertCourses = [],
  studyCourseId = null;
let pendingMove = null,
  activeAttempt = null,
  lastRenderedMode = null,
  lastPanelKey = null;
if (recoveredTraining.interrupted)
  write("training-v1", practiceSnapshot(training));
let practiceTrack = "mixed",
  mateMoves = 1;
const mateThemes = ["attack", "survive"].flatMap((mode) =>
  [1, 2, 3].map((moves) => ({
    id: `mate-${mode}-${moves}`,
    short: `${mode === "attack" ? "詰める" : "受け切る"} · 黒${moves}手`,
  })),
);
const themeName = (id) =>
  [...lessons, ...mateThemes].find((l) => l.id === id)?.short || "実戦の一手";
let drillFixed = null,
  precisionCenter = 112;
let game = {
    moves: [],
    result: null,
    id: crypto.randomUUID(),
    level,
    assisted: false,
    started: Date.now(),
    analysis: {},
  },
  hint = null,
  lessonIndex = 0,
  lessonStep = 0,
  lessonMarks = true,
  drill = null,
  drillStreak = 0,
  drillCount = 0,
  review = null,
  reviewStep = 0,
  reviewAnalysis = null,
  variation = null,
  variationStep = 0,
  autoplay = null,
  tacticWorker = null;
try {
  const draft = read("draft", null);
  if (draft) {
    const valid = validateRecord({ ...draft, rule: "freestyle15" });
    if (valid.result === "unfinished")
      game = { ...draft, moves: valid.moves, result: null, analysis: {} };
  }
} catch {}
assist = game.exam ? false : (game.assistEnabled ?? !!game.guided);
function updateLoading(state, progress = null) {
  const ready = state === "ready",
    failed = state === "error";
  const value = ready
    ? 100
    : progress
      ? Math.max(0, Math.min(100, progress.percent))
      : state === "loading"
        ? 0
        : Number($("#loading-progress").getAttribute("aria-valuenow")) || 0;
  $("#loading-progress").setAttribute("aria-valuenow", String(value));
  const preparing = progress?.stage === "initialize";
  $("#title-screen").dataset.loadStage = ready
    ? "ready"
    : failed
      ? "error"
      : preparing
        ? "prepare"
        : "download";
  $("#loading-fill").style.width = value + "%";
  $("#loading-percent").textContent = preparing ? "…" : value + "%";
  $("#loading-progress").setAttribute(
    "aria-valuetext",
    preparing ? "読み込み完了、準備中" : ready ? "準備完了" : value + "%",
  );
  $("#loading-label").textContent = ready
    ? "準備完了"
    : failed
      ? "読み込めませんでした"
      : progress?.stage === "initialize"
        ? "準備中"
        : "読み込み中";
  $("#title-start").disabled = !ready;
  $("#title-start").hidden = failed;
  $("#title-retry").hidden = !failed;
  $("#title-screen").classList.toggle("load-error", failed);
}
function dismissTitle(destination = null) {
  titleVisible = false;
  $("#title-screen").hidden = true;
  document.body.classList.remove("title-visible");
  $(".shell").inert = false;
  $(".shell").removeAttribute("aria-hidden");
  if (destination) switchMode(destination);
  else render();
  if (
    mode === "play" &&
    engine.ready &&
    game.moves.length % 2 &&
    !game.result &&
    !busy
  )
    cpuTurn();
  else if (
    mode === "play" &&
    engine.ready &&
    game.guided &&
    assist &&
    !game.result &&
    !busy &&
    !hint
  )
    getHint();
}
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("#toast").classList.remove("show"), 3500);
}
function audioStone() {
  se.play("stone");
}
function toggleSound() {
  sound = !sound;
  se.enabled = sound;
  write("sound", sound);
  $("#sound").innerHTML = icon(sound ? "sound" : "mute");
  $("#sound").setAttribute("aria-pressed", String(sound));
  $("#sound").setAttribute(
    "aria-label",
    sound ? "効果音をオフ" : "効果音をオン",
  );
  if (sound) se.play("tap");
}

function openModal(html) {
  $("#modal-body").innerHTML = html;
  const heading = $("#modal-body h2");
  if (heading) {
    heading.id = "modal-title";
    $("#modal").setAttribute("aria-labelledby", "modal-title");
  } else $("#modal").removeAttribute("aria-labelledby");
  if (!$("#modal").open) $("#modal").showModal();
}
function closeModal() {
  $("#modal").close();
}
function askDiscard(fn) {
  if (game.moves.length && !game.result) {
    openModal(
      `<h2>対局をやり直す？</h2><p>${game.exam ? "この実戦は投了として記録します。" : "進行中の棋譜は戦績に残りません。"}</p><div class="modal-actions"><button class="secondary" data-action="close-modal">戻る</button><button class="primary" id="confirm-new">やり直す</button></div>`,
    );
    $("#confirm-new").onclick = () => {
      closeModal();
      if (game.exam) {
        stopWork();
        finish("resign", { silent: true });
      }
      fn();
    };
  } else fn();
}

function stopWork() {
  epoch++;
  pendingMove = null;
  busy = false;
  hint = null;
  reviewAnalysis = null;
  variation = null;
  clearInterval(autoplay);
  autoplay = null;
  tacticWorker?.terminate();
  tacticWorker = null;
  if (engine.pending) engine.cancel();
}
function saveDraft() {
  write("draft", game.result ? null : game);
}
function stats() {
  const done = records.filter((r) =>
    ["win", "loss", "draw", "resign"].includes(r.result),
  );
  return {
    wins: done.filter((r) => r.result === "win").length,
    losses: done.filter((r) => ["loss", "resign"].includes(r.result)).length,
    draws: done.filter((r) => r.result === "draw").length,
    total: done.length,
  };
}
function currentSkin() {
  return boardSkin({
    mode,
    level,
    gameLevel: game.level,
    started: game.moves.length > 0,
    reviewLevel: review?.level,
  });
}
function syncCanvasViewport() {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    navigator.standalone === true;
  // iOS 27 can expose a WebView shorter than the physical display. Keep the
  // navigation tappable in that viewport; the board width never depends on it.
  if (standalone && window.innerWidth <= 600) {
    document.documentElement.style.setProperty(
      "--available-app-height",
      `${window.innerHeight}px`,
    );
  } else
    document.documentElement.style.removeProperty("--available-app-height");
}
function initBoard() {
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
function studyLesson() {
  const c = expertCourses.find((c) => c.id === studyCourseId);
  if (!c) return lessons[lessonIndex];
  return {
    id: c.id,
    isCourse: true,
    short: c.title,
    course: c,
    black: [],
    white: [],
    steps: c.moves.map((m) => ({
      i: m.i,
      title: m.title,
      text: m.text,
      phase: m.phase,
      marks: m.kind === "win" ? [] : m.facts?.ownWinsAfter || [],
    })),
  };
}
async function loadExpertCourses() {
  try {
    const response = await fetch(
      new URL("./expert-courses.json", import.meta.url),
    );
    if (!response.ok) return;
    const data = await response.json();
    if (data.rule !== "freestyle15") return;
    expertCourses = data.courses.filter(
      (c) =>
        /^[a-z0-9-]+$/.test(c.id) &&
        c.result === "win" &&
        validateRecord({ rule: "freestyle15", moves: c.moves, level: "max" })
          .result === "win",
    );
    if (mode === "learn") render();
  } catch {}
}
function strongestRecord() {
  const games = records.filter(
    (r) =>
      r.level === "max" &&
      !r.assisted &&
      ["win", "loss", "resign", "draw"].includes(r.result),
  );
  return {
    wins: games.filter((r) => r.result === "win").length,
    losses: games.filter((r) => ["loss", "resign"].includes(r.result)).length,
    total: games.length,
  };
}
function openExpertMenu() {
  const r = strongestRecord();
  openModal(
    `<h2>最強攻略</h2><div class="drill-stats"><span>無補助<b>${r.wins}勝 ${r.losses}敗</b></span></div>${btn("expert-guided", "解説付きで対局", "primary")}${btn("expert-exam", "無補助で挑む", "secondary")}`,
  );
}
function startExpertMatch(guided) {
  closeModal();
  askDiscard(() => {
    mode = "play";
    level = "max";
    write("level", level);
    assist = guided;
    newGame();
    game.guided = guided;
    game.assistEnabled = guided;
    game.exam = !guided;
    game.assisted = guided;
    saveDraft();
    render();
    $("main").scrollTop = 0;
    if (guided && engine.ready) getHint();
  });
}
function viewPosition() {
  if (mode === "learn") {
    const l = studyLesson();
    return {
      board: lessonBoard(l, lessonStep),
      last: lessonStep ? l.steps[lessonStep - 1].i : -1,
      moves: l.steps.slice(0, lessonStep),
      marks: lessonMarks
        ? lessonStep
          ? l.steps[lessonStep - 1].marks
          : [l.steps[0].i]
        : [],
      count: lessonStep,
    };
  }
  if (mode === "drill" && drill) {
    const board = Uint8Array.from(drill.board);
    let last = drill.last ?? -1;
    if (drill.replay) {
      const replay = drill.replay;
      const b = Uint8Array.from(replay.base);
      const moves = replay.line.slice(0, replay.step);
      for (const move of moves) b[move.i] = move.side;
      return {
        board: b,
        last: moves.at(-1)?.i ?? -1,
        moves,
        marks: [],
        count: replay.step,
      };
    }
    if (drill.showRefutation && drill.refutation !== null) {
      if (drill.refutationColor === 2 && drill.refutationOrigin !== null)
        board[drill.refutationOrigin] = 1;
      board[drill.refutation] = drill.refutationColor;
      last = drill.refutation;
    }
    return {
      board,
      last,
      moves: drill.history,
      marks: drill.showHint
        ? drill.answers
        : drill.wrong && drill.refutation !== null
          ? [drill.refutation]
          : [],
      count: drill.state.ply,
    };
  }
  if (mode === "review" && review) {
    const base = review.moves.slice(0, reviewStep);
    const moves = variation
      ? base.concat(variation.line.slice(0, variationStep).map((i) => ({ i })))
      : base;
    return {
      board: boardFrom(moves),
      last: moves.at(-1)?.i ?? -1,
      moves,
      marks: reviewAnalysis && !variation ? [reviewAnalysis.best] : [],
      count: moves.length,
    };
  }
  return {
    board: boardFrom(game.moves),
    last: game.moves.at(-1)?.i ?? -1,
    moves: game.moves,
    marks: hint ? [hint.best] : [],
    count: game.moves.length,
  };
}
function renderBoard() {
  const skin = currentSkin();
  $("#board").setAttribute(
    "aria-label",
    skin === "inferno" ? "15×15の五目盤。赤が先手、青が後手" : "15×15の五目盤",
  );
  const v = viewPosition(),
    order = new Map(v.moves.map((m, j) => [m.i, j + 1]));
  $$("[data-cell]").forEach((el, i) => {
    const c = v.board[i],
      preview = ["play", "drill"].includes(mode) && pendingMove === i && !c;
    el.className = `intersection ${c ? "occupied" : ""} ${preview ? "preview" : ""} ${i === v.last ? "last" : ""} ${numbers ? "numbered" : ""} ${v.marks?.includes(i) && !c ? "hint" : ""} ${mode === "drill" && drill?.lastWrong === i && !drill.showRefutation && !drill.replay ? "mistake-point" : ""}`;
    el.setAttribute(
      "aria-label",
      `${coord(i)} ${c ? stoneName(skin, c) : "空点"}${i === v.last ? " 最新手" : ""}${preview ? " 選択中" : ""}${v.marks?.includes(i) ? (mode === "drill" && drill.wrong && !drill.showHint ? (drill.refutationColor === 1 ? " 勝ち手" : " 白の応手") : " 推奨点") : ""}`,
    );
    el.setAttribute("aria-selected", String(preview));
    const previous = el.dataset.stone;
    el.dataset.stone = String(c);
    el.innerHTML =
      c || preview
        ? `<span class="stone ${c === 2 ? "white" : "black"} ${previous !== String(c) ? "new" : ""}">${numbers ? order.get(i) || "" : ""}</span>`
        : "";
  });
  const line = v.last >= 0 ? winningLine(v.board, v.last) : [];
  $("#board-overlay").innerHTML = line.length
    ? `<polyline points="${line
        .sort((a, b) => a - b)
        .map((i) => `${40 + (i % 15) * 40},${40 + Math.floor(i / 15) * 40}`)
        .join(
          " ",
        )}" fill="none" stroke="#a13a2d" stroke-width="5" opacity=".8" stroke-linecap="round"/>`
    : "";
  $("#move-count").textContent = String(v.count).padStart(3, "0");
  $("#numbers").setAttribute("aria-pressed", String(numbers));
  let text = "あなたの番";
  if (mode === "play") {
    text = game.result
      ? {
          win: "あなたの勝ち",
          loss: "CPUの勝ち",
          draw: "引き分け",
          resign: "投了",
        }[game.result]
      : busy
        ? game.moves.length % 2
          ? "CPUが考えています"
          : "ヒントを解析中"
        : game.moves.length % 2
          ? "CPUの番"
          : pendingMove !== null
            ? `${coord(pendingMove)}を選択中`
            : "あなたの番";
  }
  if (mode === "learn")
    text = studyCourseId
      ? `${lessonStep} / ${studyLesson().steps.length}手`
      : `型 ${lessonIndex + 1} / ${lessons.length} · ${lessonStep === 0 ? "開始局面" : lessonStep + "手目"}`;
  if (mode === "drill")
    text = drill?.replay
      ? `${drill.replay.kind === "refutation" ? "敗因" : "正解手順"} · ${drill.replay.step}/${drill.replay.line.length}手`
      : drill?.showRefutation
        ? drill.refutationColor === 1
          ? "勝ち手を確認"
          : "相手の応手を確認"
        : getSessionSummary(training)?.done && drill?.recorded
          ? "5問終了"
          : drill?.solved
            ? "完走"
            : pendingMove !== null
              ? `${coord(pendingMove)}を選択中`
              : drill?.wrong
                ? drill.refutation !== null
                  ? `${drill.refutationColor === 1 ? "勝ち手" : "白の応手"} ${coord(drill.refutation)}`
                  : "この手を見直す"
                : "黒番";
  if (mode === "review")
    text = busy
      ? "解析中"
      : variation
        ? "変化手順"
        : `棋譜 · ${reviewStep} / ${review?.moves.length || 0}手`;
  $("#turn-status").innerHTML =
    `<i class="status-dot ${busy ? "busy" : ""}"></i>${skinText(text, currentSkin())}`;
}
const actionIcons = {
  "start-set": "target",
  "open-expert-course": "learn",
  precision: "target",
  cancel: "pause",
  undo: "undo",
  hint: "hint",
  place: "stone",
  resign: "flag",
  new: "plus",
  export: "download",
  import: "upload",
  "review-current": "review",
  "lesson-first": "skip-back",
  "lesson-prev": "chevron-left",
  "lesson-next": "chevron-right",
  "lesson-marks": "eye",
  "practice-lesson": "target",
  "drill-explain": "learn",
  "drill-rotate": "rotate",
  "drill-hint": "hint",
  "next-drill": "chevron-right",
  "review-first": "skip-back",
  "review-prev": "chevron-left",
  "review-next": "chevron-right",
  "review-last": "skip-next",
  "analyze-review": "scan",
  scan: "scan",
  "first-mistake": "alert",
  variation: "branch",
  "variation-exit": "undo",
  retry: "rotate",
};
const actionNames = {
  precision: "盤面を拡大",
  "lesson-first": "最初へ",
  "lesson-prev": "前の手",
  "lesson-next": "次の手",
  "review-first": "最初へ",
  "review-prev": "前の手",
  "review-next": "次の手",
  "review-last": "最後へ",
  resign: "投了",
  hint: "ヒント",
  undo: "待った",
  export: "棋譜を書き出す",
};
const iconOnly = new Set([
  "precision",
  "lesson-prev",
  "lesson-next",
  "lesson-first",
  "lesson-play",
  "lesson-marks",
  "review-first",
  "review-prev",
  "review-next",
  "review-last",
]);
function btn(action, label, css = "secondary", disabled = false) {
  const ic =
    action === "lesson-play"
      ? autoplay
        ? "pause"
        : "play"
      : actionIcons[action];
  const clean =
    label
      .replace(/<[^>]*>/g, "")
      .replace(/[↶↗→↓◈‹›|▶]/g, "")
      .trim() ||
    actionNames[action] ||
    label;
  return `<button class="${css} ${iconOnly.has(action) ? "icon-only" : ""}" data-action="${action}" aria-label="${actionNames[action] || clean}" ${disabled ? "disabled" : ""}>${ic ? icon(ic) : ""}<span class="button-label">${clean}</span></button>`;
}

function smallStats() {
  const s = stats();
  return `<div class="card"><div class="card-heading"><h2>これまでの対局</h2><span class="kicker">RECORD</span></div><div class="stat-mini"><div><strong>${s.wins}</strong><small>勝ち</small></div><div><strong>${s.losses}</strong><small>負け</small></div><div><strong>${s.total ? Math.round((s.wins / s.total) * 100) : 0}<span style="font-size:12px">%</span></strong><small>勝率</small></div></div></div>`;
}
function analysisCard(a) {
  const explanation =
    a.tacticalKind === "miss-block"
      ? `${coord(a.actual)} → ${coord(a.best)}。白の五連を防ぐ。`
      : a.tacticalKind === "miss-win"
        ? `${coord(a.actual)} → ${coord(a.best)}。五連で勝てた。`
        : a.text || "盤上の印が推奨手。相手の応手で続きを読む。";
  return `<div class="card analysis-card"><div class="analysis-line"><strong>${coord(a.best)}</strong><h3>${a.title || "次の一手"}</h3><span class="badge">${a.proof?.proven ? "四追い確定" : "推奨"}</span></div><p class="lesson-explanation">${explanation}</p>${mode === "review" ? `<div class="analysis-buttons">${a.line?.length ? btn("variation", "変化を見る", "secondary") : ""}${a.tacticalKind ? btn("practice-mistake", "この局面を練習", "primary") : ""}</div>` : ""}<details class="analysis-details"><summary>${a.proof?.proven ? "確定手順" : "読み筋・評価"}</summary>${a.info?.DEPTH ? `<p class="analysis-meta">探索深さ ${a.info.DEPTH} · 評価 ${a.info.EVAL || "—"}</p>` : ""}${
    a.line?.length
      ? `<div class="line-chips">${a.line
          .slice(0, 12)
          .map(
            (i, j) =>
              `<button data-action="line-step" data-step="${j + 1}" ${variationStep === j + 1 ? 'class="active"' : ""}>${j + 1} ${coord(i)}</button>`,
          )
          .join("")}</div>`
      : ""
  }${a.proof?.proven ? `<p class="analysis-meta">この局面から ${a.proof.plies}手以内</p>` : ""}</details></div>`;
}

function renderPanel() {
  let html = "",
    controls = "";
  if (mode === "play") {
    const currentLevel = game.moves.length ? game.level : level;
    html = `<div class="play-settings"><div class="difficulties" aria-label="CPUの強さ">${Object.entries(
      levels,
    )
      .map(
        ([k, v]) =>
          `<button data-level="${k}" class="difficulty ${k === currentLevel ? "active" : ""}" aria-pressed="${k === currentLevel}" ${(game.exam || game.guided || game.moves.length) && !game.result ? "disabled" : ""}>${v.label}</button>`,
      )
      .join(
        "",
      )}</div><div class="settings-bottom"><button class="assist-toggle" data-action="assist" role="switch" aria-label="解説アシスト" aria-checked="${assist}" ${game.exam ? "disabled" : ""}><span class="toggle-track"><i></i></span>解説アシスト</button><span class="engine-status" ${engineState === "ready" ? "hidden" : ""}><i class="${engineState === "loading" ? "busy" : ""}"></i>${engineState === "ready" ? "準備完了" : engineState === "loading" ? "準備中" : "起動失敗"}</span></div></div>`;
    if (engineState === "error")
      html += `<div class="card">${btn("retry", "再読み込み", "primary")}</div>`;
    if (game.result) {
      html += `<div class="card result-card"><div class="result-icon">${icon(game.result === "win" ? "check" : "review")}</div><div class="result-title">${game.result === "win" ? "あなたの勝ち" : game.result === "draw" ? "引き分け" : "あなたの負け"}</div>${btn("review-current", "この対局を振り返る", "primary")}</div>`;
    } else if (hint) html += analysisCard(hint);
    else
      html += `<div class="play-shortcuts">${btn("start-set", "5問練習", "secondary")}${btn("open-expert-course", "最強攻略", "secondary")}</div>`;
    controls =
      btn(
        "undo",
        "待った",
        "icon-only",
        game.exam || !game.moves.length || !!game.result,
      ) +
      btn(
        "hint",
        "ヒント",
        "icon-only",
        game.exam ||
          busy ||
          !engine.ready ||
          !!game.result ||
          game.moves.length % 2 === 1,
      ) +
      btn(
        "place",
        pendingMove === null ? "着手" : coord(pendingMove) + " に打つ",
        "place-button",
        pendingMove === null || busy || !!game.result,
      ) +
      btn(
        "resign",
        "投了",
        "icon-only danger-button",
        !game.moves.length || !!game.result,
      );
  }

  if (mode === "learn") {
    const l = studyLesson(),
      step = l.steps[Math.max(0, lessonStep - 1)];
    html = `<div class="card lesson-card"><div class="lesson-step-head"><strong>${lessonStep ? step.title : "黒の次の一手は？"}</strong><span>${lessonStep} / ${l.steps.length}手</span></div><p class="lesson-explanation">${lessonStep ? step.text : l.id === "chain" ? "この局面は最短5手。" : ""}</p><div class="progress-track"><span style="width:${(lessonStep / l.steps.length) * 100}%"></span></div></div>`;
    if (l.isCourse) {
      const c = l.course;
      html += `<div class="course-strip"><span>${c.openingKind === "natural" ? "自然対局" : `白${coord(c.forcedOpening.i)}指定`}</span><span>黒勝ち · ${c.moves.length}手</span></div><div class="course-phases">${[
        ["序盤", 0],
        [
          "連携",
          Math.max(0, c.moves.findIndex((m) => m.phase === "build") + 1),
        ],
        [
          "攻め",
          Math.max(0, c.moves.findIndex((m) => m.phase === "attack") + 1),
        ],
        ["決着", Math.max(0, c.moves.length - 5)],
      ]
        .map(
          ([label, n]) =>
            `<button data-action="course-phase" data-step="${n}">${label}</button>`,
        )
        .join("")}</div>`;
    }
    if (!l.isCourse) html += btn("practice-lesson", "この型を練習", "primary");
    controls =
      btn("lesson-first", "最初へ", "") +
      btn("lesson-prev", "前の手", "grow", !lessonStep) +
      btn("lesson-play", autoplay ? "停止" : "再生", "") +
      btn("lesson-next", "次の手", "grow", lessonStep === l.steps.length) +
      btn("lesson-marks", lessonMarks ? "印を隠す" : "印を表示", "");
  }

  if (mode === "drill" && drill) {
    const summary = getSessionSummary(training),
      stats = getThemeStats(training, drill.position.lessonId);
    if (drill.replay) {
      const r = drill.replay;
      const before = Uint8Array.from(r.base);
      for (const m of r.line.slice(0, Math.max(0, r.step - 1)))
        before[m.i] = m.side;
      const move = r.line[r.step - 1];
      const note = move
        ? annotateMove(before, move.i, move.side).text
        : r.kind === "refutation"
          ? drill.feedback
          : drill.position.goal;
      html = `<div class="card drill-card"><div class="lesson-step-head"><strong>${r.kind === "refutation" ? "敗因を確認" : "正解手順"}</strong><span>${r.step}/${r.line.length}手</span></div><p class="lesson-explanation">${note}</p></div>`;
    } else if (summary?.done && drill.recorded) {
      html = `<div class="card session-card"><h2>5問チェック 終了</h2><div class="drill-stats"><span>初回正解<b>${summary.clean}/${summary.size}</b></span><span>完走<b>${summary.completed}/${summary.size}</b></span></div>${summary.weakThemes.length ? `<p class="lesson-explanation">復習：${summary.weakThemes.map(themeName).join("・")}</p>` : ""}${drill.position.type === "mate" && !drill.isSummary ? btn("drill-answer", "最後の問題の解説", "secondary") : ""}${btn("start-set", "次の5問", "primary")}${btn("show-training-record", "練習記録", "secondary")}</div>`;
    } else {
      html = `<div class="card drill-card"><div class="lesson-step-head"><strong>${drill.solved ? (drill.finish?.length ? "勝ち確定" : "完走") : drill.wrong ? "見直す" : drill.state.ply ? "続きの一手" : "黒の一手"}</strong><span>${summary ? Math.min(summary.answered + (drill.recorded ? 0 : 1), summary.size) + " / " + summary.size + "問" : ""}</span></div>${drill.feedback ? `<p class="lesson-explanation" role="status">${drill.feedback}</p>` : drill.position.type === "mate" ? `<p class="lesson-explanation">${drill.position.goal}</p>` : drill.position.metadata.goalType === "prevent-open-four" ? '<p class="lesson-explanation">次の両端の空いた四を防ぐ。</p>' : ""}${drill.solved ? `${drill.finish?.length ? btn("drill-finish", "詰みを確認", "secondary") : ""}<div class="drill-stats"><span>別配置の初回完走<b>${stats.uniqueCleanVariants}</b></span><span>${stats.status === "passed" ? "確認済" : "練習中"}</span></div>${drill.position.type === "mate" ? btn("drill-answer", "正解手順", "secondary") : ""}${drill.lesson ? `<p class="solved-theme">${drill.lesson.short}</p>${btn("drill-explain", "この型の解説", "secondary")}` : ""}${btn("next-drill", "次の問題", "primary")}` : `<div class="drill-tools">${btn("drill-hint", "ヒント", "secondary")}${drill.refutation !== null ? btn("drill-refutation", drill.showRefutation ? "問題に戻る" : drill.refutationColor === 1 ? "勝ち手を見る" : "応手を見る", "secondary") : ""}${btn("drill-explain", "解説", "secondary")}</div>`}</div>`;
    }
    controls =
      btn("drill-skip", "見送る", "", drill.solved || drill.recorded) +
      btn(
        "drill-confirm",
        pendingMove === null ? "回答" : coord(pendingMove) + " に打つ",
        "place-button",
        pendingMove === null ||
          drill.solved ||
          drill.showRefutation ||
          !!drill.replay,
      );
    if (drill.replay)
      controls =
        btn("drill-replay-prev", "前の手", "", !drill.replay.step) +
        btn(
          "drill-replay-next",
          "次の手",
          "primary",
          drill.replay.step >= drill.replay.line.length,
        ) +
        btn("drill-replay-exit", "問題に戻る", "");
  }

  if (mode === "review") {
    if (!review) {
      html = `<div class="card"><h2>検討する棋譜を選ぶ</h2>${btn("records", "戦績から選ぶ", "primary")}${btn("import", "棋譜を読み込む")}</div>`;
      controls = "";
    } else {
      html = `<div class="card"><div class="card-heading"><h2>手順の検討</h2><span class="badge">${levels[review.level]?.label || "棋譜"}</span></div><div class="step-label"><strong>${reviewStep}</strong><span>/ ${review.moves.length} 手</span></div><div class="progress-track"><span style="width:${(reviewStep / Math.max(review.moves.length, 1)) * 100}%"></span></div><div class="divider"></div>${btn("analyze-review", reviewStep < review.moves.length ? `${reviewStep + 1}手目を検討` : "最終局面", "primary", busy || !engine.ready || reviewStep >= review.moves.length)}<div style="margin-top:10px">${btn("scan", "黒の全手を解析", busy ? "busy secondary" : "secondary", busy || !engine.ready)}</div><p class="analysis-meta" id="scan-status">${review.scanSummary || ""}</p><details class="history-details"><summary>棋譜一覧</summary><div class="move-list">${review.moves.map((m, j) => `<button class="move-item ${j === reviewStep ? "active" : ""}" data-review-step="${j}">${j + 1}<i class="tiny-stone ${j % 2 ? "white" : "black"}"></i>${coord(m.i)}${review.analysis?.[j]?.severity ? "<em>!</em>" : ""}</button>`).join("")}</div></details></div>`;
      if (reviewAnalysis) html = analysisCard(reviewAnalysis) + html;
      else
        html += `<div class="card"><h3>見落としを探す</h3><div class="legend"><span><i></i>改善手</span><span style="color:var(--red)">! 要検討</span></div>${btn("first-mistake", "最初の見落としへ")}</div>`;
      controls =
        btn("review-first", "|‹") +
        btn("review-prev", "‹", "", !reviewStep) +
        `<input id="review-slider" type="range" min="0" max="${review.moves.length}" value="${reviewStep}" aria-label="棋譜の手数">` +
        btn("review-next", "›", "", reviewStep >= review.moves.length) +
        btn("review-last", "›|");
    }
  }
  if (engineState === "error" && mode === "review")
    html =
      `<div class="card"><h2>エンジンを再起動</h2>${btn("retry", "再読み込み", "primary")}</div>` +
      html;
  const panelKey = JSON.stringify(
    mode === "learn"
      ? [mode, studyCourseId, lessonIndex, lessonStep]
      : mode === "drill"
        ? [
            mode,
            drill?.position.variantId,
            drill?.state.ply,
            drill?.wrongAttempts,
            drill?.solved,
            drill?.replay?.kind,
            drill?.replay?.step,
          ]
        : mode === "review"
          ? [
              mode,
              review?.id,
              reviewStep,
              variationStep,
              reviewAnalysis?.best,
              reviewAnalysis?.title,
            ]
          : [
              mode,
              game.id,
              game.moves.length,
              hint?.best,
              hint?.title,
              game.result,
            ],
  );
  const scrollTop =
    panelKey === lastPanelKey ? $("#panel-content")?.scrollTop || 0 : 0;
  lastPanelKey = panelKey;
  html = skinText(html, currentSkin());
  $("#panel").innerHTML =
    `<div id="panel-content" class="panel-content" role="region" aria-label="解説と情報" tabindex="0">${html}</div><div class="panel-actions"></div>`;
  const content = $("#panel-content"),
    footer = $("#panel .panel-actions");
  const selector =
    mode === "play"
      ? ".play-settings"
      : mode === "drill"
        ? drill?.replay
          ? null
          : drill?.solved
            ? '[data-action="next-drill"],[data-action="start-set"]'
            : ".drill-tools"
        : mode === "review"
          ? reviewAnalysis
            ? ".analysis-buttons"
            : '[data-action="analyze-review"],[data-action="scan"]'
          : mode === "learn"
            ? studyCourseId
              ? ".course-phases"
              : '[data-action="practice-lesson"]'
            : null;
  if (selector)
    content.querySelectorAll(selector).forEach((el) => footer.append(el));
  footer.hidden = false;
  content.scrollTop = scrollTop;
  if (mode !== "review") controls += btn("precision", "拡大", "icon-only");
  const container = $("#board-controls");
  if (
    mode === "review" &&
    review &&
    container.dataset.viewMode === "review" &&
    $("#review-slider")
  ) {
    $("#review-slider").max = review.moves.length;
    $("#review-slider").value = reviewStep;
    container.querySelector('[data-action="review-prev"]').disabled =
      !reviewStep;
    container.querySelector('[data-action="review-next"]').disabled =
      reviewStep >= review.moves.length;
  } else container.innerHTML = controls;
  container.dataset.viewMode = mode;
  if (mode === "review" && review) {
    const cursor = variation ? variationStep : reviewStep,
      limit = variation ? variation.line.length : review.moves.length;
    $("#review-slider").max = limit;
    $("#review-slider").value = cursor;
    $("#review-slider").setAttribute(
      "aria-label",
      variation ? "変化の手数" : "棋譜の手数",
    );
    container.querySelector('[data-action="review-prev"]').disabled = !cursor;
    container.querySelector('[data-action="review-next"]').disabled =
      cursor >= limit;
  }
  const marks = $('[data-action="lesson-marks"]');
  if (marks) marks.setAttribute("aria-pressed", String(lessonMarks));
}
function renderStats() {
  const s = stats();
  $("#records-view").innerHTML =
    `<div class="records-grid"><div class="card"><strong>${s.total}</strong><small>総対局</small></div><div class="card"><strong>${s.wins}<span style="font-size:20px"> / ${s.losses}</span></strong><small>勝ち / 負け · 引き分け ${s.draws}</small></div><div class="card"><strong>${s.total ? Math.round((s.wins / s.total) * 100) : 0}<span style="font-size:20px">%</span></strong><small>勝率</small></div></div><div class="expert-record"><span>最強・無補助</span><strong>${strongestRecord().wins}勝 ${strongestRecord().losses}敗</strong></div><div class="record-toolbar"><h2>対局の記録</h2>${btn("import", "棋譜を読み込む")}</div><div class="record-list">${
      records.length
        ? records
            .slice()
            .reverse()
            .map(
              (r, j) =>
                `<button class="record-card" data-record="${records.length - 1 - j}"><strong class="${["loss", "resign"].includes(r.result) ? "loss" : ""}">${{ win: "勝ち", loss: "負け", draw: "引分", resign: "負け", unfinished: "—" }[r.result] || "—"}</strong><div class="record-info">${levels[r.level]?.label || "棋譜"} <span class="badge ${r.assisted ? "" : "red"}">${r.assisted ? "アシストあり" : "実戦"}</span><small>${new Date(Number(r.started) || Date.now()).toLocaleString("ja-JP")} · ${r.moves.length}手${r.result === "resign" ? " · 投了" : ""}</small></div><span class="record-arrow">${icon("chevron-right")}</span></button>`,
            )
            .join("")
        : '<div class="empty-state">記録なし</div>'
    }</div>`;
}
function renderContext() {
  let html = "";
  if (mode === "learn")
    html = `<select id="lesson-select" aria-label="学ぶ型・攻略棋譜"><optgroup label="基礎の型">${lessons.map((l, j) => `<option value="${j}" ${!studyCourseId && j === lessonIndex ? "selected" : ""}>${j + 1}. ${l.short}${getThemeStats(training, l.id).status === "passed" ? " ✓" : ""}</option>`).join("")}</optgroup>${expertCourses.length ? `<optgroup label="最強CPUの攻略棋譜">${expertCourses.map((c, j) => `<option value="course:${c.id}" ${studyCourseId === c.id ? "selected" : ""}>${j + 1}. ${c.openingKind === "natural" ? "自然対局" : `白${coord(c.forcedOpening.i)}分岐`} · ${c.moves.length}手</option>`).join("")}</optgroup>` : ""}</select>${studyCourseId ? `<button class="icon-button" data-action="expert-menu" aria-label="最強CPUに挑む">${icon("play")}</button>` : ""}`;
  if (mode === "drill" && drill) {
    const summary = getSessionSummary(training);
    html = `<select id="practice-track" aria-label="練習の種類"><option value="mixed" ${practiceTrack === "mixed" ? "selected" : ""}>${drillFixed ? drill.label : drill.queueId ? "実戦の一手" : "5問練習"}</option><option value="attack" ${practiceTrack === "attack" ? "selected" : ""}>詰める</option><option value="survive" ${practiceTrack === "survive" ? "selected" : ""}>受け切る</option></select>${practiceTrack !== "mixed" ? `<select id="mate-length" aria-label="黒が打つ手数">${[1, 2, 3].map((n) => `<option value="${n}" ${n === mateMoves ? "selected" : ""}>黒${n}手</option>`).join("")}</select>` : ""}<button class="icon-button" data-action="show-training-record" aria-label="練習記録">${icon("stats")}</button>`;
  }
  if (mode === "review")
    html = `<div class="review-context-title"><h2>棋譜検討</h2><span id="review-state" role="status">${busy ? "解析中" : variation ? `変化 ${variationStep}/${variation.line.length}` : review ? `${reviewStep}/${review.moves.length}手` : ""}</span></div><div class="context-actions"><button class="icon-button" data-action="precision" aria-label="盤面を拡大">${icon("target")}</button><button class="icon-button" data-action="${busy ? "cancel" : variation ? "variation-exit" : "export"}" aria-label="${busy ? "解析を止める" : variation ? "本譜に戻る" : "棋譜を書き出す"}">${icon(busy ? "pause" : variation ? "undo" : "download")}</button></div>`;
  if (mode === "stats") html = "<h2>戦績</h2>";
  $("#context-bar").innerHTML = html;
}
function render() {
  const focus = rememberFocus(),
    modeChanged = lastRenderedMode !== mode;
  lastRenderedMode = mode;
  const labels = {
      play: "対局",
      learn: "型を学ぶ",
      drill: "反復練習",
      review: "棋譜検討",
      stats: "戦績",
    },
    titles = {
      play: "その一手で、<em>仕留めろ。</em>",
      learn: "勝てる形を、<em>その手に。</em>",
      drill: "考える前に、<em>見抜け。</em>",
      review: "敗れた一手を、<em>武器に。</em>",
      stats: "積み重ねが、<em>強さになる。</em>",
    };
  document.body.dataset.mode = mode;
  document.body.dataset.skin = currentSkin();
  renderContext();
  $("#sound").innerHTML = icon(sound ? "sound" : "mute");
  $("#sound").setAttribute("aria-pressed", String(sound));
  $("#sound").setAttribute(
    "aria-label",
    sound ? "効果音をオフ" : "効果音をオン",
  );
  $("#mode-label").textContent = labels[mode];
  $("#page-title").innerHTML = titles[mode];
  $$(".nav[data-mode]").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === mode);
    b.setAttribute("aria-current", b.dataset.mode === mode ? "page" : "false");
  });
  $("#arena").hidden = mode === "stats";
  $("#records-view").hidden = mode !== "stats";
  $(".board-column").hidden = false;
  $("#opponent-name").textContent =
    engineState === "loading"
      ? "準備中"
      : engineState === "error"
        ? "起動失敗"
        : game.exam
          ? game.assisted
            ? "最強 · 補助あり"
            : "最強 · 無補助"
          : game.guided
            ? "最強 · 解説"
            : levels[game.moves.length ? game.level : level].label;
  $("#opponent-label").innerHTML =
    `CPU <small>${stoneName(currentSkin(), 2)}</small>`;
  if (mode === "stats") renderStats();
  else {
    renderBoard();
    renderPanel();
  }
  restoreFocus(focus);
  if (modeChanged) {
    $("main").scrollTop = 0;
    if ($("#panel-content")) $("#panel-content").scrollTop = 0;
  }
}
function markStudyAssistance() {
  if (game.result || game.assisted || !game.moves.length) return;
  game.assisted = true;
  saveDraft();
  toast("教材・検討を開いた対局は補助ありで記録");
}
function switchMode(next) {
  if (next === mode) return;
  if (["learn", "drill", "review"].includes(next)) markStudyAssistance();
  if (mode === "drill" && next === "learn" && drill && !drill.recorded) {
    drill.assisted = true;
    markActiveDrill();
  }
  stopWork();
  mode = next;
  $("main").scrollTop = 0;
  if (mode === "drill" && !drill) {
    if (!training.session) training = startTrainingSession(training, 5);
    drillFixed = null;
    newDrill();
  }
  if (mode === "review" && !review && game.moves.length) loadReview(game);
  render();
  $("main").scrollTop = 0;
  if (mode === "play" && !game.result && game.moves.length % 2 && engine.ready)
    cpuTurn();
}
function newGame() {
  stopWork();
  game = {
    moves: [],
    result: null,
    id: crypto.randomUUID(),
    level,
    assisted: assist,
    assistEnabled: assist,
    started: Date.now(),
    analysis: {},
  };
  saveDraft();
  render();
}
function finish(result, { silent = false } = {}) {
  if (!silent) se.play(result === "win" ? "win" : "lose");
  game.result = result;
  game.finished = Date.now();
  if (!records.some((r) => r.id === game.id)) {
    records.push(structuredClone(game));
    write("records", records);
  }
  saveDraft();
  render();
  if (!silent)
    openModal(
      `<div class="result-card"><div class="result-icon">${icon(result === "win" ? "check" : "review")}</div><h2>${result === "win" ? "あなたの勝ち" : result === "draw" ? "引き分け" : "あなたの負け"}</h2><p>${game.moves.length}手 · ${levels[game.level].label}</p>${btn("review-current", "対局を振り返る", "primary")}<div style="margin-top:10px">${btn("rematch", "もう一局")}</div></div>`,
    );
}
function put(i) {
  const b = boardFrom(game.moves);
  if (b[i] || game.result) return;
  const c = (game.moves.length % 2) + 1;
  game.moves.push({ i });
  pendingMove = null;
  audioStone();
  b[i] = c;
  hint = null;
  saveDraft();
  if (winningLine(b, i).length) finish(c === 1 ? "win" : "loss");
  else if (game.moves.length === 225) finish("draw");
  render();
}
async function cpuTurn() {
  if (busy || !engine.ready || game.result || game.moves.length % 2 === 0)
    return;
  const token = epoch;
  busy = true;
  thinkingDepth = 0;
  render();
  try {
    const result = await engine.search(game.moves, levels[game.level]);
    if (token !== epoch || mode !== "play") return;
    const b = boardFrom(game.moves);
    if (
      b[result.i] ||
      !Number.isInteger(result.i) ||
      result.i < 0 ||
      result.i >= 225
    )
      throw Error("CPUの着手が不正です");
    busy = false;
    put(result.i);
    if (assist && !game.result) await getHint();
  } catch (e) {
    if (token !== epoch) return;
    busy = false;
    if (e.message !== "cancelled") toast(e.message);
    render();
  }
}
function tactics(board, color) {
  tacticWorker?.terminate();
  return new Promise((resolve) => {
    const worker = (tacticWorker = new Worker(
      new URL("./tactics-worker.js", import.meta.url),
      { type: "module" },
    ));
    const timer = setTimeout(() => {
      worker.terminate();
      resolve({ proven: false, timeout: true });
    }, 3500);
    worker.onmessage = ({ data }) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(data);
    };
    worker.onerror = () => {
      clearTimeout(timer);
      worker.terminate();
      resolve({ proven: false });
    };
    worker.postMessage({ board: Array.from(board), color });
  });
}
function pv(info) {
  return (info.BESTLINE?.match(/\d+,\d+/g) || [])
    .map((s) => {
      const [x, y] = s.split(",").map(Number);
      return y * 15 + x;
    })
    .filter((i) => i >= 0 && i < 225);
}
function safeLine(moves, line) {
  const b = boardFrom(moves),
    out = [];
  let c = (moves.length % 2) + 1;
  for (const i of line) {
    if (b[i] || winner(b)) break;
    b[i] = c;
    out.push(i);
    c = 3 - c;
  }
  return out;
}
async function evaluate(moves, ms = 1800, token = epoch) {
  const b = boardFrom(moves),
    c = (moves.length % 2) + 1;
  const proof = await tactics(b, c);
  if (token !== epoch) throw Error("cancelled");
  const r = await engine.search(moves, { ms, strength: 100 });
  if (token !== epoch) throw Error("cancelled");
  const best = proof.proven ? proof.line[0] : r.i;
  return {
    best,
    proof,
    info: r.info,
    line: safeLine(
      moves,
      proof.proven ? proof.line : pv(r.info)[0] === best ? pv(r.info) : [best],
    ),
    title: proof.proven
      ? `${proof.plies}手以内の勝ち`
      : annotateMove(b, best, c).title,
    text: annotateMove(b, best, c).text,
  };
}
async function getHint() {
  if (
    game.exam ||
    busy ||
    game.result ||
    game.moves.length % 2 ||
    !engine.ready
  )
    return;
  const token = epoch;
  busy = true;
  game.assisted = true;
  render();
  try {
    const a = await evaluate(game.moves, game.guided ? 8000 : 1800);
    if (token !== epoch) return;
    hint = a;
    busy = false;
    saveDraft();
    render();
  } catch (e) {
    if (token === epoch) {
      busy = false;
      toast(e.message);
      render();
    }
  }
}
function saveTraining() {
  write("training-v1", practiceSnapshot(training, activeAttempt));
}
function markActiveDrill() {
  if (!drill || drill.recorded) return;
  activeAttempt = {
    themeId: drill.position.lessonId,
    variantId: drill.position.variantId,
    hinted: drill.assisted,
    wrongAttempts: drill.wrongAttempts,
  };
  saveTraining();
}
function rememberFocus() {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const attrs = ["data-action", "data-cell", "data-review-step"];
  if (el.id) return "#" + CSS.escape(el.id);
  for (const k of attrs)
    if (el.hasAttribute(k)) return `[${k}="${el.getAttribute(k)}"]`;
  return null;
}
function restoreFocus(selector) {
  if (titleVisible) return;
  if (!selector || $("#modal").open) return;
  let el = $(selector);
  if (el?.disabled && selector.includes("next"))
    el = $(selector.replace("next", "prev"));
  if (
    (el?.disabled || el?.closest("[hidden]")) &&
    mode === "drill" &&
    getSessionSummary(training)?.done
  )
    el = $('[data-action="start-set"]');
  if (el && !el.disabled && document.activeElement !== el)
    el.focus({ preventScroll: true });
}
function recordDrill(completed) {
  if (!drill || drill.recorded) return;
  drill.recorded = true;
  activeAttempt = null;
  training = recordTrainingAttempt(training, {
    themeId: drill.position.lessonId,
    variantId: drill.position.variantId,
    completed,
    firstTry: drill.wrongAttempts === 0,
    hinted: drill.assisted,
    wrongAttempts: drill.wrongAttempts,
  });
  if (completed && !drill.assisted && !drill.wrongAttempts) {
    drillStreak++;
    if (drill.queueId)
      training = removeTacticalMistake(training, drill.queueId);
  } else drillStreak = 0;
  drillCount++;
  saveTraining();
}
function setDrillPosition(position, lesson = null, queueId = null) {
  pendingMove = null;
  const state =
    position.type === "mate"
      ? createMateState(position)
      : createPositionState(position, {
          defenseChoice: Math.floor(Math.random() * 4),
        });
  drill = {
    position,
    state,
    lesson: lesson || lessons.find((l) => l.id === position.lessonId),
    queueId,
    label: position.label,
    board: state.board,
    answers: state.answers,
    last: -1,
    history: [],
    solved: false,
    wrong: false,
    showHint: false,
    showRefutation: false,
    attempts: 0,
    wrongAttempts: 0,
    assisted: false,
    recorded: false,
    lastWrong: null,
    refutationOrigin: null,
    refutation: null,
    refutationColor: null,
    feedback: "",
    replay: null,
    wrongReplay: [],
    finish: [],
  };
}
function newDrill(fixed = null) {
  if (drill && !drill.recorded && (drill.attempts || drill.assisted))
    recordDrill(false);
  if (!training.session) training = startTrainingSession(training, 5);
  if (fixed) {
    drillFixed = fixed.id;
    practiceTrack = "mixed";
  }
  const l =
    fixed ||
    lessons.find(
      (l) =>
        l.id ===
        (drillFixed ||
          chooseNextTheme(
            training,
            lessons.map((l) => l.id),
          )),
    ) ||
    lessons[0];
  if (practiceTrack === "mixed") setDrillPosition(makeTrainingPosition(l), l);
  else
    setDrillPosition(makeMatePuzzle({ mode: practiceTrack, moves: mateMoves }));
  if (getSessionSummary(training)?.done) {
    drill.isSummary = true;
    drill.recorded = true;
    drill.solved = true;
    drill.board = new Uint8Array(225);
    drill.answers = [];
  }
  saveTraining();
}
function drillMove(i) {
  if (
    !drill ||
    drill.solved ||
    drill.showRefutation ||
    drill.replay ||
    drill.board[i]
  )
    return;
  pendingMove = null;
  drill.attempts++;
  const outcome =
    drill.position.type === "mate"
      ? judgeMateMove(drill.state, i)
      : judgeTrainingMove(drill.state, i);
  drill.feedback =
    drill.position.type === "mate"
      ? outcome.feedback
      : outcome.done
        ? drill.position.metadata.goalType === "prevent-open-four"
          ? "白が両端の空いた四を作れなくなった。"
          : drill.position.metadata.goalType === "force-win"
            ? ""
            : "白の五連を防いだ。"
        : outcome.feedback;
  if (outcome.correct) {
    drill.state = outcome.state;
    drill.board = outcome.state.board;
    drill.answers = outcome.state.answers;
    drill.last = outcome.state.last;
    drill.history.push({ i });
    if (Number.isInteger(outcome.whiteMove))
      drill.history.push({ i: outcome.whiteMove });
    drill.lastWrong = null;
    drill.refutation = null;
    drill.wrong = false;
    drill.showHint = false;
    drill.solved = outcome.done;
    drill.finish = outcome.finish || [];
    if (outcome.done) {
      recordDrill(true);
      se.play("correct");
    } else se.play("stone");
  } else {
    drill.wrong = true;
    drill.wrongAttempts++;
    drill.lastWrong = i;
    drill.refutationOrigin = i;
    drill.refutation = outcome.refutation;
    drill.refutationColor = outcome.refutationColor;
    drill.wrongReplay = outcome.replay || [];
    se.play("wrong");
  }
  if (!drill.recorded) markActiveDrill();
  render();
}
function openDrillReplay(kind) {
  const initial = kind === "answer";
  const line = initial
    ? [...drill.position.certificate.line, ...drill.position.certificate.finish]
    : kind === "finish"
      ? drill.finish
      : drill.wrongReplay;
  if (!line.length) return;
  if (!drill.recorded) {
    drill.assisted = true;
    markActiveDrill();
  }
  pendingMove = null;
  drill.replay = {
    kind,
    base: Uint8Array.from(initial ? drill.position.board : drill.board),
    line,
    step: 0,
  };
  render();
  $("main").scrollTop = 0;
}
function startSet() {
  markStudyAssistance();
  stopWork();
  if (drill && !drill.recorded && (drill.attempts || drill.assisted))
    recordDrill(false);
  training = startTrainingSession(training, 5);
  drillFixed = null;
  drill = null;
  newDrill();
  mode = "drill";
  $("main").scrollTop = 0;
  render();
}
function showTrainingRecord() {
  openModal(
    `<h2>練習記録</h2><div class="training-record">${[...lessons, ...mateThemes]
      .map((l) => {
        const st = getThemeStats(training, l.id);
        return `<div><strong>${l.short}</strong><span>${st.status === "passed" ? "確認済" : st.attempts ? "練習中" : "未着手"}</span><small>初回正解 ${Math.round(st.firstTryAccuracy * 100)}% · 別配置 ${st.uniqueCleanVariants}</small></div>`;
      })
      .join(
        "",
      )}</div>${btn("start-set", "5問チェック", "primary")}${getTacticalMistake(training) ? btn("queued-mistake", "実戦の見落としを練習", "secondary") : ""}`,
  );
}
function practiceRecord(item, { shown = false } = {}) {
  const position = createTacticalPosition(item);
  if (drill && !drill.recorded && (drill.attempts || drill.assisted))
    recordDrill(false);
  stopWork();
  drillFixed = null;
  practiceTrack = "mixed";
  if (!training.session || getSessionSummary(training)?.done)
    training = startTrainingSession(training, 5);
  setDrillPosition(position, null, item.id);
  if (shown) {
    drill.assisted = true;
    drill.feedback = "見直した一手を打つ。";
    markActiveDrill();
  }
  mode = "drill";
  closeModal();
  render();
  $("main").scrollTop = 0;
}
function showPrecision() {
  const cell = Number(document.activeElement?.dataset.cell),
    v = viewPosition();
  precisionCenter =
    pendingMove ?? (Number.isInteger(cell) ? cell : v.last >= 0 ? v.last : 112);
  renderPrecision();
}
function precisionEditable() {
  return mode === "play"
    ? engine.ready && !busy && !game.result && game.moves.length % 2 === 0
    : mode === "drill" &&
        drill &&
        !drill.solved &&
        !drill.showRefutation &&
        !drill.replay;
}
function renderPrecision() {
  const editable = precisionEditable(),
    v = viewPosition(),
    x = Math.max(1, Math.min(13, precisionCenter % 15)),
    y = Math.max(1, Math.min(13, Math.floor(precisionCenter / 15)));
  let cells = "";
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const i = (y + dy) * 15 + x + dx,
        c = v.board[i];
      cells += `<button data-action="precise-pick" data-index="${i}" class="precise-cell ${i === pendingMove ? "chosen" : ""}" aria-label="${coord(i)} ${c ? stoneName(currentSkin(), c) : "空点"}" aria-pressed="${i === pendingMove}" ${c || !editable ? "disabled" : ""}>${c ? `<img src="${stoneSprite(currentSkin(), c)}" alt="">` : '<span class="precision-cross"></span>'}<b>${coord(i)}</b></button>`;
    }
  openModal(
    `<h2>${editable ? "交点を選ぶ" : "周囲を拡大"}</h2><div class="precision-grid">${cells}</div><div class="precision-pan">${[-15, -1, 1, 15].map((d, j) => `<button data-action="precision-pan" data-delta="${d}" aria-label="${["上", "左", "右", "下"][j]}へ">${["↑", "←", "→", "↓"][j]}</button>`).join("")}</div>`,
  );
}

function loadReview(r) {
  markStudyAssistance();
  review = structuredClone(r);
  review.analysis ??= {};
  reviewStep = 0;
  reviewAnalysis = null;
  variation = null;
}
function setReviewCursor(n) {
  if (variation) {
    variationStep = Math.max(0, Math.min(n, variation.line.length));
    render();
  } else setReviewStep(n);
}
function setReviewStep(n) {
  if (busy) stopWork();
  reviewStep = Math.max(0, Math.min(n, review?.moves.length || 0));
  variation = null;
  variationStep = 0;
  reviewAnalysis = review?.analysis?.[reviewStep] || null;
  render();
}
function persistReview() {
  const r = records.find((r) => r.id === review.id);
  if (r) {
    r.analysis = review.analysis;
    r.scanSummary = review.scanSummary;
    write("records", records);
  }
  if (game.id === review.id) game.analysis = review.analysis;
}
function evalScore(value) {
  const s = String(value);
  const m = /^([+-]?)M(\d+)$/.exec(s);
  return m ? (m[1] === "-" ? -1 : 1) * (100000 - Number(m[2])) : Number(s);
}
function explanation(type, actual, best) {
  const labels = {
    win: "実戦の一手で五連。勝ちを逃さなかった。",
    "miss-win": `実戦は${coord(actual)}。${coord(best)}なら、その場で五連だった。`,
    "miss-block": `実戦は${coord(actual)}。相手の即勝ちを止める必要があった。`,
    block: "相手の即勝ちを止めた一手。",
    fork: "二つ以上の勝ち口を作った一手。",
    four: "四を作り、相手に守りを迫った。",
    "forced-loss":
      "着手前から相手に二つ以上の勝ち口がある。この手より前を振り返る。",
  };
  return (
    labels[type] ||
    `実戦 ${coord(actual)} / 推奨 ${coord(best)}。探索による比較。`
  );
}
async function analyzeAt(j, token, ms = 1500) {
  const moves = review.moves.slice(0, j),
    b = boardFrom(moves),
    c = (j % 2) + 1,
    actual = review.moves[j].i,
    t = classify(b, actual, c);
  const a = await evaluate(moves, ms);
  if (token !== epoch) return null;
  a.actual = actual;
  if (j % 2 === 0 && ["miss-win", "miss-block"].includes(t.type)) {
    a.tacticalKind = t.type;
    a.tacticalBoard = Array.from(b);
    a.tacticalId = review.id + ":" + j;
    training = enqueueTacticalMistake(training, {
      id: a.tacticalId,
      board: b,
      kind: t.type,
      actual,
      side: 1,
      recordId: review.id,
      moveIndex: j,
    });
    saveTraining();
  }
  a.severity = t.severity;
  a.title = t.text;
  a.text = explanation(t.type, actual, t.best ?? a.best);
  if (t.best !== undefined) a.best = t.best;
  if (
    !a.severity &&
    actual !== a.best &&
    !["win", "block", "fork", "forced-loss"].includes(t.type)
  ) {
    const next = await engine.search(review.moves.slice(0, j + 1), {
      ms,
      strength: 100,
    });
    if (token !== epoch) return null;
    const before = evalScore(a.info.EVAL),
      after = -evalScore(next.info.EVAL);
    if (Number.isFinite(before) && Number.isFinite(after)) {
      a.drop = before - after;
      if (a.drop > 250) {
        a.severity = 1;
        a.title = "評価が下がった一手";
        a.text = `実戦 ${coord(actual)} / 推奨 ${coord(a.best)}。評価差 ${Math.round(a.drop)}。探索上の改善候補。`;
      }
    }
  }
  if (a.severity >= 2) a.title = t.text;
  review.analysis[j] = a;
  return a;
}
async function analyzeReview(all = false) {
  markStudyAssistance();
  if (
    busy ||
    !review ||
    !engine.ready ||
    (reviewStep >= review.moves.length && !all)
  )
    return;
  const token = epoch;
  busy = true;
  render();
  try {
    if (all) {
      let seen = 0;
      for (let j = 0; j < review.moves.length; j += 2) {
        if (token !== epoch) return;
        if (!review.analysis[j]) await analyzeAt(j, token, 900);
        if (token !== epoch) return;
        seen++;
        $("#scan-status").textContent =
          `黒の手を解析 ${seen} / ${Math.ceil(review.moves.length / 2)}`;
      }
      const errors = Object.entries(review.analysis).filter(
        ([j, a]) => +j % 2 === 0 && a.severity,
      );
      const certain = errors.filter(([, a]) => a.severity >= 2);
      review.scanSummary = `黒 ${seen}手 · 見落とし ${certain.length} · 改善候補 ${errors.length - certain.length}${certain.length ? " / 最初の見落とし " + (Number(certain[0][0]) + 1) + "手目" : ""}`;
      busy = false;
      persistReview();
      const first = certain[0] || errors[0];
      setReviewStep(first ? Number(first[0]) : 0);
      $("main").scrollTop = 0;
      toast("全手の解析が完了");
    } else {
      const j = reviewStep;
      reviewAnalysis = await analyzeAt(j, token);
      if (token !== epoch) return;
      busy = false;
      persistReview();
      render();
      $("main").scrollTop = 0;
    }
  } catch (e) {
    if (token === epoch) {
      busy = false;
      toast(e.message);
      render();
    }
  }
}
function exportRecord() {
  const r = mode === "review" && review ? review : game;
  if (!r.moves.length) return toast("棋譜がありません");
  const data = { ...r, version: 1, rule: "freestyle15" };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `楚涵-${new Date().toISOString().slice(0, 10)}-${r.moves.length}moves.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function stepLesson(n) {
  clearInterval(autoplay);
  autoplay = null;
  lessonStep = Math.max(0, Math.min(n, studyLesson().steps.length));
  render();
}
const actions = {
  "open-expert-course": () => {
    if (!expertCourses.length) {
      toast("教材を読み込み中");
      return;
    }
    studyCourseId = expertCourses[0].id;
    lessonStep = 0;
    switchMode("learn");
  },
  "expert-menu": openExpertMenu,
  "expert-guided": () => startExpertMatch(true),
  "expert-exam": () => startExpertMatch(false),
  "course-phase": (el) => stepLesson(Number(el.dataset.step)),
  "title-start": () => {
    if (engine.ready) dismissTitle();
  },
  "title-learn": () => {
    lessonIndex = 0;
    lessonStep = 0;
    dismissTitle("learn");
  },
  precision: showPrecision,
  "learn-basics": () => {
    studyCourseId = null;
    lessonIndex = 0;
    lessonStep = 0;
    switchMode("learn");
  },
  "precise-pick": (el) => {
    if (!precisionEditable()) return;
    pendingMove = Number(el.dataset.index);
    closeModal();
    render();
  },
  "precision-pan": (el) => {
    const d = Number(el.dataset.delta);
    let x = precisionCenter % 15,
      y = Math.floor(precisionCenter / 15);
    if (Math.abs(d) === 1) x = Math.max(0, Math.min(14, x + d));
    else y = Math.max(0, Math.min(14, y + d / 15));
    precisionCenter = y * 15 + x;
    renderPrecision();
    $('[data-action="precision-pan"][data-delta="' + d + '"]')?.focus({
      preventScroll: true,
    });
  },
  "drill-confirm": () => {
    if (pendingMove !== null) drillMove(pendingMove);
  },
  "drill-refutation": () => {
    if (drill.position.type === "mate" && drill.wrongReplay.length) {
      openDrillReplay("refutation");
      return;
    }
    drill.showRefutation = !drill.showRefutation;
    pendingMove = null;
    render();
  },
  "drill-answer": () => openDrillReplay("answer"),
  "drill-finish": () => openDrillReplay("finish"),
  "drill-replay-prev": () => {
    drill.replay.step = Math.max(0, drill.replay.step - 1);
    render();
  },
  "drill-replay-next": () => {
    drill.replay.step = Math.min(
      drill.replay.line.length,
      drill.replay.step + 1,
    );
    render();
  },
  "drill-replay-exit": () => {
    drill.replay = null;
    render();
  },
  "drill-skip": () => {
    recordDrill(false);
    if (getSessionSummary(training)?.done) {
      pendingMove = null;
      drill.solved = true;
      drill.isSummary = true;
      drill.showHint = false;
      render();
    } else {
      newDrill();
      render();
    }
  },
  "start-set": () => {
    closeModal();
    startSet();
  },
  "show-training-record": showTrainingRecord,
  "queued-mistake": () => {
    const item = getTacticalMistake(training);
    if (item) practiceRecord(item);
  },
  "practice-mistake": () => {
    if (reviewAnalysis?.tacticalKind)
      practiceRecord(
        {
          id: reviewAnalysis.tacticalId,
          board: reviewAnalysis.tacticalBoard,
          kind: reviewAnalysis.tacticalKind,
        },
        { shown: true },
      );
  },
  new: () => {
    closeModal();
    askDiscard(() => {
      mode = "play";
      $("main").scrollTop = 0;
      newGame();
    });
  },
  rematch: () => {
    if (game.exam || game.guided) startExpertMatch(!!game.guided);
    else actions.new();
  },
  place: () => {
    if (
      pendingMove === null ||
      busy ||
      !engine.ready ||
      game.result ||
      game.moves.length % 2
    )
      return;
    const i = pendingMove;
    if (!game.moves.length) game.level = level;
    put(i);
    if (!game.result) cpuTurn();
  },
  undo: () => {
    if (game.exam) return;
    stopWork();
    game.moves.splice(
      Math.max(0, game.moves.length - (game.moves.length % 2 ? 1 : 2)),
    );
    game.assisted = true;
    saveDraft();
    render();
  },
  hint: getHint,
  assist: () => {
    if (game.exam) return;
    assist = !assist;
    game.assistEnabled = assist;
    if (assist) game.assisted = true;
    else {
      if (busy && game.moves.length % 2 === 0) stopWork();
      hint = null;
    }
    saveDraft();
    render();
    if (assist) getHint();
  },
  cpu: cpuTurn,
  retry: () => engine.cancel(),
  resign: () =>
    openModal(
      '<h2>この対局を終える？</h2><p>投了として戦績に記録します。</p><div class="modal-actions">' +
        btn("close-modal", "続ける") +
        btn("confirm-resign", "投了する", "primary") +
        "</div>",
    ),
  "confirm-resign": () => {
    closeModal();
    stopWork();
    finish("resign");
  },
  "close-modal": closeModal,
  "sound-setting": () => {
    toggleSound();
    $("#modal-sound-state").textContent = sound ? "オン" : "オフ";
  },
  "numbers-setting": () => {
    numbers = !numbers;
    write("numbers", numbers);
    $("#modal-number-state").textContent = numbers ? "オン" : "オフ";
    renderBoard();
  },
  learn: () => {
    lessonIndex = 2;
    lessonStep = 0;
    switchMode("learn");
  },
  records: () => switchMode("stats"),
  "review-current": () => {
    closeModal();
    stopWork();
    loadReview(game);
    mode = "review";
    render();
  },
  export: exportRecord,
  import: () => $("#import-file").click(),
  "lesson-first": () => stepLesson(0),
  "lesson-prev": () => stepLesson(lessonStep - 1),
  "lesson-next": () => stepLesson(lessonStep + 1),
  "lesson-marks": () => {
    lessonMarks = !lessonMarks;
    render();
  },
  "lesson-play": () => {
    if (autoplay) {
      clearInterval(autoplay);
      autoplay = null;
      render();
      return;
    }
    if (lessonStep === studyLesson().steps.length) lessonStep = 0;
    autoplay = setInterval(() => {
      lessonStep++;
      if (lessonStep >= studyLesson().steps.length) {
        clearInterval(autoplay);
        autoplay = null;
      }
      render();
    }, 1300);
    render();
  },
  "practice-lesson": () => {
    if (studyCourseId) {
      openExpertMenu();
      return;
    }
    if (drill && !drill.recorded && (drill.attempts || drill.assisted))
      recordDrill(false);
    training = startTrainingSession(training, 5);
    drill = null;
    newDrill(lessons[lessonIndex]);
    switchMode("drill");
  },
  "next-drill": () => {
    newDrill();
    render();
  },
  "drill-hint": () => {
    drill.showHint = true;
    drill.assisted = true;
    markActiveDrill();
    render();
  },
  "drill-rotate": () => {
    newDrill(drill.lesson);
    render();
  },
  "drill-explain": () => {
    if (drill.position.type === "mate") {
      openDrillReplay("answer");
      return;
    }
    drill.assisted = true;
    markActiveDrill();
    if (!drill.lesson) {
      drill.showHint = true;
      render();
      return;
    }
    studyCourseId = null;
    lessonIndex = lessons.findIndex((l) => l.id === drill.lesson.id);
    lessonStep = 0;
    switchMode("learn");
  },
  "review-first": () => setReviewCursor(0),
  "review-prev": () =>
    setReviewCursor((variation ? variationStep : reviewStep) - 1),
  "review-next": () =>
    setReviewCursor((variation ? variationStep : reviewStep) + 1),
  "review-last": () =>
    setReviewCursor(variation ? variation.line.length : review.moves.length),
  "analyze-review": () => analyzeReview(),
  scan: () => analyzeReview(true),
  cancel: () => {
    stopWork();
    render();
  },
  "first-mistake": () => {
    const b = new Uint8Array(225);
    for (let j = 0; j < review.moves.length; j++) {
      const t = classify(b, review.moves[j].i, (j % 2) + 1);
      if (j % 2 === 0 && (t.severity || review.analysis[j]?.severity)) {
        setReviewStep(j);
        if (engine.ready) analyzeReview();
        return;
      }
      b[review.moves[j].i] = (j % 2) + 1;
    }
    toast("即勝ち・四の見落としはありません。全手解析で比較できます");
  },
  variation: () => {
    if (reviewAnalysis?.line?.length) {
      variation = reviewAnalysis;
      variationStep = 1;
      render();
      $("main").scrollTop = 0;
    }
  },
  "line-step": (el) => {
    if (mode === "review" && reviewAnalysis?.line?.length) {
      variation = reviewAnalysis;
      variationStep = Math.min(Number(el.dataset.step), variation.line.length);
      render();
    } else if (mode === "play" && hint?.line?.length) {
      const a = hint,
        step = Number(el.dataset.step);
      stopWork();
      loadReview(game);
      reviewStep = game.moves.length;
      reviewAnalysis = a;
      variation = a;
      variationStep = Math.min(step, a.line.length);
      mode = "review";
      render();
    }
  },
  "variation-exit": () => {
    variation = null;
    variationStep = 0;
    render();
  },
};
document.addEventListener("click", (e) => {
  const el = e.target.closest("button");
  if (!el || el.disabled) return;
  if (
    el.dataset.action !== "place" &&
    el.dataset.cell === undefined &&
    el.id !== "sound"
  )
    se.play("tap");
  if (el.dataset.mode) return switchMode(el.dataset.mode);
  if (el.dataset.level) {
    if ((game.exam || game.guided) && !game.result) return;
    level = el.dataset.level;
    write("level", level);
    if (!game.moves.length) game.level = level;
    render();
    return;
  }
  if (el.dataset.lesson !== undefined) {
    lessonIndex = Number(el.dataset.lesson);
    $("main").scrollTop = 0;
    stepLesson(0);
    return;
  }
  if (el.dataset.record !== undefined) {
    stopWork();
    loadReview(records[Number(el.dataset.record)]);
    mode = "review";
    render();
    return;
  }
  if (el.dataset.reviewStep !== undefined)
    return setReviewStep(Number(el.dataset.reviewStep));
  if (el.dataset.action) return actions[el.dataset.action]?.(el);
  if (el.dataset.cell !== undefined) {
    const i = Number(el.dataset.cell);
    if (mode === "drill") {
      if (
        drill.solved ||
        drill.showRefutation ||
        drill.replay ||
        drill.board[i]
      )
        return;
      pendingMove = i;
      drill.lastWrong = null;
      se.play("tap");
      render();
      return;
    }
    if (mode !== "play" || busy || game.result || game.moves.length % 2) return;
    if (!engine.ready)
      return toast(
        engineState === "error"
          ? "エンジンの再読み込みが必要です"
          : "Rapfiを読み込んでいます",
      );
    if (!boardFrom(game.moves)[i]) {
      pendingMove = i;
      se.play("tap");
      render();
    }
  }
});
$("#review-slider")?.addEventListener("input", (e) =>
  setReviewCursor(Number(e.target.value)),
);
document.addEventListener("input", (e) => {
  if (e.target.id === "review-slider") setReviewCursor(Number(e.target.value));
});
$("#board").addEventListener("focusin", (e) => {
  const cell = e.target.closest("[data-cell]");
  if (!cell) return;
  $$('[data-cell][tabindex="0"]').forEach((el) => {
    if (el !== cell) el.tabIndex = -1;
  });
  cell.tabIndex = 0;
});
$("#board").addEventListener("keydown", (e) => {
  const el = e.target.closest("[data-cell]");
  if (!el) return;
  let i = Number(el.dataset.cell),
    n = i;
  if (e.key === "ArrowLeft") n = i % 15 ? i - 1 : i;
  if (e.key === "ArrowRight") n = i % 15 < 14 ? i + 1 : i;
  if (e.key === "ArrowUp") n = i >= 15 ? i - 15 : i;
  if (e.key === "ArrowDown") n = i < 210 ? i + 15 : i;
  if (n !== i) {
    e.preventDefault();
    el.tabIndex = -1;
    const target = $(`[data-cell="${n}"]`);
    target.tabIndex = 0;
    target.focus();
  }
});
$("#numbers").onclick = () => {
  numbers = !numbers;
  renderBoard();
};
$("#sound").onclick = toggleSound;
$(".modal-close").onclick = closeModal;
$("#about").onclick = () =>
  openModal(
    `<h2>設定</h2><button class="settings-option" data-action="sound-setting">${icon("sound")}効果音<span class="state" id="modal-sound-state">${sound ? "オン" : "オフ"}</span></button><button class="settings-option" data-action="numbers-setting">${icon("board")}手順番号<span class="state" id="modal-number-state">${numbers ? "オン" : "オフ"}</span></button><div class="rule-chips"><span>15 × 15</span><span>黒先手</span><span>禁手なし</span><span>五連以上</span></div><details><summary>ルール・出典</summary><p>縦・横・斜めに五つ以上並べると勝ち。三三・四四・長連も有効。</p><p>最強はRapfi NNUEの本アプリ内最高設定。推奨手は完全解ではありません。</p><p><a href="https://cdn.aaai.org/Symposia/Fall/1993/FS-93-02/FS93-02-001.pdf" target="_blank" rel="noopener">黒必勝の研究</a><br><a href="https://github.com/dotb1ue/rapfi" target="_blank" rel="noopener">Rapfi / engine authors</a> · <a href="engine/LICENSE.txt" target="_blank">GPL-3.0</a><br><a href="engine/SOURCE.txt" target="_blank">出典</a> · <a href="engine/rapfi-source.tar.gz">ソース</a></p></details>`,
  );

$("#import-file").onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  if (f.size > 2_000_000) return toast("棋譜ファイルが大きすぎます");
  try {
    const r = validateRecord(JSON.parse(await f.text()));
    r.id = crypto.randomUUID();
    r.started = Number(r.started) || Date.now();
    r.assisted = true;
    r.scanSummary = "";
    stopWork();
    loadReview(r);
    mode = "review";
    render();
    toast("棋譜を読み込みました");
  } catch (e) {
    toast(e.message || "棋譜を読み込めません");
  }
};
const engine = new Engine(
  (state, message) => {
    engineState = state;
    updateLoading(state);
    if (typeof render === "function" && $("#intersections").children.length) {
      render();
      if (
        state === "ready" &&
        !titleVisible &&
        mode === "play" &&
        game.moves.length % 2 &&
        !game.result &&
        !busy
      )
        cpuTurn();
      else if (
        state === "ready" &&
        !titleVisible &&
        mode === "play" &&
        game.guided &&
        assist &&
        !game.result &&
        game.moves.length % 2 === 0 &&
        !busy
      )
        getHint();
    }
    if (message) toast(message);
  },
  (d) => {
    if (d.key === "DEPTH") {
      thinkingDepth = Number(d.value);
      renderBoard();
    }
  },
  (progress) => updateLoading("progress", progress),
);
document.addEventListener("change", (e) => {
  if (e.target.id === "practice-track" || e.target.id === "mate-length") {
    if (e.target.id === "practice-track") practiceTrack = e.target.value;
    else mateMoves = Number(e.target.value);
    startSet();
  }
  if (e.target.id === "lesson-select") {
    const value = e.target.value;
    if (value.startsWith("course:")) studyCourseId = value.slice(7);
    else {
      studyCourseId = null;
      lessonIndex = Number(value);
    }
    stepLesson(0);
  }
});
const navIcons = {
  play: "board",
  learn: "learn",
  drill: "target",
  review: "review",
  stats: "stats",
};
$$(".nav[data-mode]").forEach((el) => {
  el.querySelector(".nav-icon").innerHTML = icon(navIcons[el.dataset.mode]);
});
syncCanvasViewport();
window.addEventListener("resize", syncCanvasViewport);
window.visualViewport?.addEventListener("resize", syncCanvasViewport);
initBoard();
render();
if (recoveredTraining.interrupted) toast("中断した問題を記録しました");
loadExpertCourses();
