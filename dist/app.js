import {
  boardFrom,
  winningLine,
  winningMoves,
  winner,
  coord,
  classify,
  validateRecord,
} from "./game.js";
import { lessons, lessonBoard, makePuzzle } from "./lessons.js";
import { Engine } from "./engine-client.js";
import { Sounds } from "./sound.js";
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
let records = Array.isArray(storedRecords)
    ? storedRecords.filter((r) => r && Array.isArray(r.moves))
    : [],
  progress = read("progress", {}),
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
let pendingMove = null;
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
  $("#modal").showModal();
}
function closeModal() {
  $("#modal").close();
}
function askDiscard(fn) {
  if (game.moves.length && !game.result) {
    openModal(
      '<span class="kicker">NEW GAME</span><h2>対局をやり直す？</h2><p>進行中の棋譜は戦績に残りません。</p><div class="modal-actions"><button class="secondary" data-action="close-modal">戻る</button><button class="primary" id="confirm-new">やり直す</button></div>',
    );
    $("#confirm-new").onclick = () => {
      closeModal();
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
function initBoard() {
  let svg = "";
  for (let j = 0; j < 15; j++) {
    const p = 40 + j * 40;
    svg += `<path d="M40 ${p}H600 M${p} 40V600" fill="none" stroke="#706d4e" stroke-width=".8"/>`;
    svg += `<text x="${p}" y="18" text-anchor="middle">${String.fromCharCode(65 + j)}</text><text x="18" y="${p + 3}" text-anchor="middle">${15 - j}</text><text x="${p}" y="628" text-anchor="middle">${String.fromCharCode(65 + j)}</text><text x="624" y="${p + 3}" text-anchor="middle">${15 - j}</text>`;
  }
  for (const [x, y] of [
    [3, 3],
    [11, 3],
    [7, 7],
    [3, 11],
    [11, 11],
  ])
    svg += `<circle cx="${40 + x * 40}" cy="${40 + y * 40}" r="3" fill="#626443"/>`;
  $("#board-lines").innerHTML = svg;
  $("#intersections").innerHTML = Array.from(
    { length: 225 },
    (_, i) =>
      `<button class="intersection" data-cell="${i}" role="gridcell" aria-label="${coord(i)} 空点" tabindex="${i === 112 ? 0 : -1}"></button>`,
  ).join("");
}
function viewPosition() {
  if (mode === "learn") {
    const l = lessons[lessonIndex];
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
  if (mode === "drill" && drill)
    return {
      board: drill.board,
      last: drill.last ?? -1,
      moves: [],
      marks: drill.showHint ? drill.answers : [],
      count: drillCount,
    };
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
  const v = viewPosition(),
    order = new Map(v.moves.map((m, j) => [m.i, j + 1]));
  $$("[data-cell]").forEach((el, i) => {
    const c = v.board[i],
      preview = mode === "play" && pendingMove === i && !c;
    el.className = `intersection ${c ? "occupied" : ""} ${preview ? "preview" : ""} ${i === v.last ? "last" : ""} ${numbers ? "numbered" : ""} ${v.marks?.includes(i) && !c ? "hint" : ""}`;
    el.setAttribute(
      "aria-label",
      `${coord(i)} ${c === 1 ? "黒" : c === 2 ? "白" : "空点"}${i === v.last ? " 最新手" : ""}`,
    );
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
    text = `型 ${lessonIndex + 1} / ${lessons.length} · ${lessonStep === 0 ? "開始局面" : lessonStep + "手目"}`;
  if (mode === "drill") text = drill?.solved ? "正解" : "黒の一手を選ぶ";
  if (mode === "review")
    text = busy
      ? "解析中"
      : variation
        ? "変化手順"
        : `棋譜 · ${reviewStep} / ${review?.moves.length || 0}手`;
  $("#turn-status").innerHTML =
    `<i class="status-dot ${busy ? "busy" : ""}"></i>${text}`;
}
const actionIcons = {
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
  return `<div class="card"><div class="card-heading"><h2>${a.proof?.proven ? "勝ち筋を発見" : "次の一手"}</h2><span class="badge">${a.proof?.proven ? "四追い確定" : "Rapfi 推奨"}</span></div><div class="analysis-title">${coord(a.best)} <span style="font-size:12px">${a.title || ""}</span></div><p class="lesson-explanation">${a.text || "盤上の印が推奨手。相手の応手で続きを読み直す。"}</p>${a.info?.DEPTH ? `<div class="analysis-meta">探索深さ ${a.info.DEPTH} · 評価 ${a.info.EVAL || "—"}</div>` : ""}${
    a.line?.length
      ? `<div class="line-chips">${a.line
          .slice(0, 9)
          .map(
            (i, j) =>
              `<button data-action="line-step" data-step="${j + 1}" ${variationStep === j + 1 ? 'class="active"' : ""}>${j + 1} ${coord(i)}</button>`,
          )
          .join(
            "",
          )}</div>${mode === "review" ? btn("variation", "変化を盤上で見る") : '<div class="analysis-meta">' + (a.proof?.proven ? "この局面から " + a.proof.plies + " 手以内" : "読み筋の一例") + "</div>"}`
      : ""
  }</div>`;
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
          `<button data-level="${k}" class="difficulty ${k === currentLevel ? "active" : ""}" aria-pressed="${k === currentLevel}" ${game.moves.length && !game.result ? "disabled" : ""}>${v.label}</button>`,
      )
      .join(
        "",
      )}</div><div class="settings-bottom"><button class="assist-toggle" data-action="assist" role="switch" aria-label="解説アシスト" aria-checked="${assist}"><span class="toggle-track"><i></i></span>解説アシスト</button><span class="engine-status"><i class="${engineState === "loading" ? "busy" : ""}"></i>${engineState === "ready" ? "準備完了" : engineState === "loading" ? "準備中" : "起動失敗"}</span></div>${engineState === "error" ? btn("retry", "再読み込み") : ""}</div>`;
    if (game.result) {
      html += `<div class="card result-card"><div class="result-icon">${icon(game.result === "win" ? "check" : "review")}</div><div class="result-title">${game.result === "win" ? "あなたの勝ち" : game.result === "draw" ? "引き分け" : "あなたの負け"}</div>${btn("review-current", "この対局を振り返る", "primary")}</div>`;
    } else if (hint) html += analysisCard(hint);
    controls =
      btn("undo", "待った", "icon-only", !game.moves.length || !!game.result) +
      btn(
        "hint",
        "ヒント",
        "icon-only",
        busy || !engine.ready || !!game.result || game.moves.length % 2 === 1,
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
    if (engine.ready && !busy && game.moves.length % 2 && !game.result)
      controls += btn("cpu", "CPUを再開");
  }

  if (mode === "learn") {
    const l = lessons[lessonIndex],
      step = l.steps[Math.max(0, lessonStep - 1)];
    html = `<div class="card lesson-card"><div class="lesson-step-head"><strong>${lessonStep ? step.title : "黒の次の一手は？"}</strong><span>${lessonStep} / ${l.steps.length}手</span></div><p class="lesson-explanation">${lessonStep ? step.text : l.id === "chain" ? "この局面は最短5手。黒の一手を考える。" : "盤上の形を見て、次の一手を考える。"}</p><div class="progress-track"><span style="width:${(lessonStep / l.steps.length) * 100}%"></span></div></div>`;
    controls =
      btn("lesson-first", "最初へ", "") +
      btn("lesson-prev", "前の手", "grow", !lessonStep) +
      btn("lesson-play", autoplay ? "停止" : "再生", "") +
      btn("lesson-next", "次の手", "grow", lessonStep === l.steps.length) +
      btn("lesson-marks", lessonMarks ? "印を隠す" : "印を表示", "");
  }

  if (mode === "drill") {
    html = `<div class="card drill-card"><div class="drill-stats"><span>連続正解<b>${drillStreak}</b></span><span>回答数<b>${drillCount}</b></span></div>${drill.solved ? `<div class="drill-result">${icon("check")}正解</div><p class="lesson-explanation">${drill.assisted ? "次はヒントなしで。" : "形と手番を見抜けた。"}</p>${btn("next-drill", "次の問題", "primary")}` : drill.wrong ? `<div class="drill-result error-result">${icon("alert")}もう一度</div><p class="lesson-explanation">${drill.feedback}</p>` : btn("drill-hint", "ヒントを見る", "secondary")}</div>`;
    controls =
      btn("drill-explain", "この型の解説", "grow") +
      btn("drill-rotate", "向きを変える", "grow");
  }

  if (mode === "review") {
    if (!review) {
      html = `<div class="card"><span class="kicker">REVIEW</span><h2 style="margin-top:15px">検討する棋譜を選ぶ</h2>${btn("records", "戦績から選ぶ", "primary")}${btn("import", "棋譜を読み込む")}</div>`;
      controls = "";
    } else {
      html = `<div class="card"><div class="card-heading"><h2>手順の検討</h2><span class="badge">${levels[review.level]?.label || "棋譜"}</span></div><div class="step-label"><strong>${reviewStep}</strong><span>/ ${review.moves.length} 手</span></div><div class="progress-track"><span style="width:${(reviewStep / Math.max(review.moves.length, 1)) * 100}%"></span></div><div class="divider"></div>${btn("analyze-review", reviewStep < review.moves.length ? `${reviewStep + 1}手目を検討` : "最終局面", "primary", busy || !engine.ready || reviewStep >= review.moves.length)}<div style="margin-top:10px">${btn("scan", "黒の全手を解析", busy ? "busy secondary" : "secondary", busy || !engine.ready)}</div><p class="analysis-meta" id="scan-status">${review.scanSummary || "着手前の局面で、実戦の一手と比較。"}</p><div class="move-list">${review.moves.map((m, j) => `<button class="move-item ${j === reviewStep ? "active" : ""}" data-review-step="${j}">${j + 1}<i class="tiny-stone ${j % 2 ? "white" : "black"}"></i>${coord(m.i)}${review.analysis?.[j]?.severity ? "<em>!</em>" : ""}</button>`).join("")}</div></div>`;
      if (reviewAnalysis) html += analysisCard(reviewAnalysis);
      else
        html += `<div class="card"><span class="kicker">FIND THE TURNING POINT</span><h3 style="margin-top:15px">見落としを探す</h3><div class="legend"><span><i></i>改善手</span><span style="color:var(--red)">! 要検討</span></div>${btn("first-mistake", "最初の見落としへ")}</div>`;
      controls =
        btn("review-first", "|‹") +
        btn("review-prev", "‹", "", !reviewStep) +
        `<input id="review-slider" type="range" min="0" max="${review.moves.length}" value="${reviewStep}" aria-label="棋譜の手数">` +
        btn("review-next", "›", "", reviewStep >= review.moves.length) +
        btn("review-last", "›|") +
        btn("export", "棋譜 ↓");
      if (variation) controls += btn("variation-exit", "本譜に戻る");
      if (busy) controls += btn("cancel", "解析を止める");
    }
  }
  $("#panel").innerHTML = html;
  $("#board-controls").innerHTML = controls;
}
function renderStats() {
  const s = stats();
  $("#records-view").innerHTML =
    `<div class="records-grid"><div class="card"><strong>${s.total}</strong><small>総対局</small></div><div class="card"><strong>${s.wins}<span style="font-size:20px"> / ${s.losses}</span></strong><small>勝ち / 負け · 引き分け ${s.draws}</small></div><div class="card"><strong>${s.total ? Math.round((s.wins / s.total) * 100) : 0}<span style="font-size:20px">%</span></strong><small>勝率</small></div></div><div class="record-toolbar"><h2>対局の記録</h2>${btn("import", "棋譜を読み込む")}</div><div class="record-list">${
      records.length
        ? records
            .slice()
            .reverse()
            .map(
              (r, j) =>
                `<button class="record-card" data-record="${records.length - 1 - j}"><strong class="${["loss", "resign"].includes(r.result) ? "loss" : ""}">${{ win: "勝ち", loss: "負け", draw: "引分", resign: "負け", unfinished: "—" }[r.result] || "—"}</strong><div class="record-info">${levels[r.level]?.label || "棋譜"} <span class="badge ${r.assisted ? "" : "red"}">${r.assisted ? "アシストあり" : "実戦"}</span><small>${new Date(Number(r.started) || Date.now()).toLocaleString("ja-JP")} · ${r.moves.length}手${r.result === "resign" ? " · 投了" : ""}</small></div><span class="record-arrow">${icon("chevron-right")}</span></button>`,
            )
            .join("")
        : '<div class="empty-state"><strong>一局目は、ここから。</strong>対局を終えると、ここに記録される。</div>'
    }</div>`;
}
function renderContext() {
  let html = "";
  if (mode === "learn")
    html = `<select id="lesson-select" aria-label="学ぶ型">${lessons.map((l, j) => `<option value="${j}" ${j === lessonIndex ? "selected" : ""}>${j + 1}. ${l.short}${progress[l.id] ? " ✓" : ""}</option>`).join("")}</select><button class="icon-button" data-action="practice-lesson" aria-label="この型を練習">${icon("target")}</button>`;
  if (mode === "drill" && drill)
    html = `<div><h2>${drill.label}</h2><span class="context-sub">黒の一手</span></div><button class="icon-button" data-action="next-drill" aria-label="別の問題">${icon("skip-next")}</button>`;
  if (mode === "review")
    html = `<h2>棋譜検討</h2><button class="icon-button" data-action="export" aria-label="棋譜を書き出す">${icon("download")}</button>`;
  if (mode === "stats") html = "<h2>戦績</h2>";
  $("#context-bar").innerHTML = html;
}
function render() {
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
  renderContext();
  $("#sound").innerHTML = icon(sound ? "sound" : "mute");
  $("#sound").setAttribute("aria-pressed", String(sound));
  $("#mode-label").textContent = labels[mode];
  $("#page-title").innerHTML = titles[mode];
  $$("[data-mode]").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === mode);
    b.setAttribute("aria-current", b.dataset.mode === mode ? "page" : "false");
  });
  $("#arena").hidden = mode === "stats";
  $("#records-view").hidden = mode !== "stats";
  $("#opponent-name").textContent =
    engineState === "loading"
      ? "準備中"
      : engineState === "error"
        ? "起動失敗"
        : levels[game.moves.length ? game.level : level].label;
  $("#opponent-label").innerHTML = "CPU <small>白・後手</small>";
  if (mode === "stats") renderStats();
  else {
    renderBoard();
    renderPanel();
  }
}
function switchMode(next) {
  if (next === mode) return;
  stopWork();
  mode = next;
  $("main").scrollTop = 0;
  if (mode === "drill" && !drill) newDrill();
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
    started: Date.now(),
    analysis: {},
  };
  saveDraft();
  render();
}
function finish(result) {
  se.play(result === "win" ? "win" : "lose");
  game.result = result;
  game.finished = Date.now();
  if (!records.some((r) => r.id === game.id)) {
    records.push(structuredClone(game));
    write("records", records);
  }
  saveDraft();
  render();
  openModal(
    `<div class="result-card"><div class="result-icon">${icon(result === "win" ? "check" : "review")}</div><h2>${result === "win" ? "あなたの勝ち" : result === "draw" ? "引き分け" : "あなたの負け"}</h2><p>${game.moves.length}手 · ${levels[game.level].label}</p>${btn("review-current", "対局を振り返る", "primary")}<div style="margin-top:10px">${btn("new", "もう一局")}</div></div>`,
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
      : classify(b, best, c).text,
  };
}
async function getHint() {
  if (busy || game.result || game.moves.length % 2 || !engine.ready) return;
  const token = epoch;
  busy = true;
  game.assisted = true;
  render();
  try {
    const a = await evaluate(game.moves);
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
function newDrill(fixed = null, rotate = false) {
  let l = fixed || lessons[Math.floor(Math.random() * lessons.length)];
  const t =
    rotate && drill ? (drill.transform + 1) % 8 : Math.floor(Math.random() * 8);
  drill = {
    ...makePuzzle(l, t),
    solved: false,
    wrong: false,
    showHint: false,
    attempts: 0,
  };
}
function drillMove(i) {
  if (drill.solved || drill.board[i]) return;
  drill.attempts++;
  if (drill.answers.includes(i)) {
    drill.solved = true;
    drill.last = i;
    drill.board[i] = 1;
    drillCount++;
    if (drill.attempts === 1 && !drill.assisted) {
      drillStreak++;
      progress[drill.lesson.id] = (progress[drill.lesson.id] || 0) + 1;
      write("progress", progress);
    } else drillStreak = 0;
    se.play("correct");
  } else {
    drill.wrong = true;
    drillStreak = 0;
    se.play("wrong");
    drill.feedback =
      classify(drill.board, i, 1).type === "miss-block"
        ? "遠くにある白の四が先。勝ち口を探す。"
        : "勝ち口と、相手が止められる数を数え直す。";
  }
  render();
}
function loadReview(r) {
  review = structuredClone(r);
  review.analysis ??= {};
  reviewStep = 0;
  reviewAnalysis = null;
  variation = null;
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
      const first = errors[0];
      setReviewStep(first ? Number(first[0]) : 0);
      toast("全手の解析が完了");
    } else {
      const j = reviewStep;
      reviewAnalysis = await analyzeAt(j, token);
      if (token !== epoch) return;
      busy = false;
      persistReview();
      render();
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
  a.download = `sokan-${new Date().toISOString().slice(0, 10)}-${r.moves.length}moves.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function stepLesson(n) {
  clearInterval(autoplay);
  autoplay = null;
  lessonStep = Math.max(0, Math.min(n, lessons[lessonIndex].steps.length));
  render();
}
const actions = {
  new: () => {
    closeModal();
    askDiscard(() => {
      mode = "play";
      $("main").scrollTop = 0;
      newGame();
    });
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
    assist = !assist;
    if (assist) {
      game.assisted = true;
      saveDraft();
    }
    render();
    if (assist) getHint();
  },
  cpu: cpuTurn,
  retry: () => engine.cancel(),
  resign: () =>
    openModal(
      '<span class="kicker">RESIGN</span><h2>この対局を終える？</h2><p>投了として戦績に記録します。</p><div class="modal-actions">' +
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
    if (lessonStep === lessons[lessonIndex].steps.length) lessonStep = 0;
    autoplay = setInterval(() => {
      lessonStep++;
      if (lessonStep >= lessons[lessonIndex].steps.length) {
        clearInterval(autoplay);
        autoplay = null;
      }
      render();
    }, 1300);
    render();
  },
  "practice-lesson": () => {
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
    render();
  },
  "drill-rotate": () => {
    newDrill(drill.lesson, true);
    render();
  },
  "drill-explain": () => {
    lessonIndex = lessons.findIndex((l) => l.id === drill.lesson.id);
    lessonStep = 0;
    switchMode("learn");
  },
  "review-first": () => setReviewStep(0),
  "review-prev": () => setReviewStep(reviewStep - 1),
  "review-next": () => setReviewStep(reviewStep + 1),
  "review-last": () => setReviewStep(review.moves.length),
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
    if (mode === "drill") return drillMove(i);
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
  setReviewStep(Number(e.target.value)),
);
document.addEventListener("input", (e) => {
  if (e.target.id === "review-slider") setReviewStep(Number(e.target.value));
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
    if (typeof render === "function" && $("#intersections").children.length) {
      render();
      if (
        state === "ready" &&
        mode === "play" &&
        game.moves.length % 2 &&
        !game.result &&
        !busy
      )
        cpuTurn();
    }
    if (message) toast(message);
  },
  (d) => {
    if (d.key === "DEPTH") {
      thinkingDepth = Number(d.value);
      renderBoard();
    }
  },
);
document.addEventListener("change", (e) => {
  if (e.target.id === "lesson-select") {
    lessonIndex = Number(e.target.value);
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
$$("[data-mode]").forEach((el) => {
  el.querySelector(".nav-icon").innerHTML = icon(navIcons[el.dataset.mode]);
});
initBoard();
render();
