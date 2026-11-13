import {
  boardFrom,
  winningLine,
  winningMoves,
  winner,
  coord,
  validateRecord,
} from "./game.js";
import { Engine } from "./engine-client.js";
import { Sounds } from "./sound.js";
import { boardSkin, stoneName, stoneSprite, skinText } from "./board-themes.js";
import { initBoard, renderBoard } from "./board-view.js?v=patterns-20261111-v2";
import {
  units,
  problems,
} from "./curriculum.js?v=curriculum-v5-stage3-20261113";
import { positionMoves, reviewStartPly } from "./training-sessions.js";
import { assessmentProblems } from "./assessment-bank.js?v=curriculum-v5-stage3-20261113";
import {
  createPathProgress,
  noteExposure,
  recordAttemptEvidence,
  unitStatus,
  selectAssessment,
  nextLearningStep,
  assessmentAvailability,
  recordPracticalResult,
  getExamStatus,
  recordReviewFindings,
} from "./learning-path.js?v=curriculum-v5-stage3-20261113";
import {
  journeyTracks,
  createJourney,
  playJourneyMove,
  applyJourneyReply,
  getJourneyView,
  getJourneyResult,
  restoreJourney,
  markJourneyAssistance,
  retryJourney,
  previewJourneyMove,
} from "./journey.js?v=learning-v3-20261111";

import {
  createAttempt,
  playLearningMove,
  answerLearningChoice,
  getLearningView,
  getDemoFrames,
  hintLearning,
  hideLearningHints,
  retryLearning,
  restoreLearningAttempt,
  markLearningGuidance,
  createLearningProgress,
  recordLearningAttempt,
  recordLessonView,
  recordBoardExposure,
  getLearningStats,
} from "./learning.js?v=curriculum-v5-stage3-20261113";
import {
  describeMove,
  judgeReviewMove,
} from "./causal-review.js?v=learning-v3-20261111";
import { patternHighlights } from "./review-patterns.js?v=patterns-20261111-v2";
import {
  strategyMarkup,
  strategyExposure,
  strategyRecordExposures,
} from "./strategy-guide.js?v=strategy-20261112";

const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icon = (n) =>
  `<svg class='ui-icon' aria-hidden='true'><use href='assets/ui-icons.svg#${n}'/></svg>`;
const button = (action, label, cls = "secondary", extra = "") =>
  `<button class='${cls}' data-action='${action}' ${extra}>${label}</button>`;
const ib = (action, name, label, disabled = false) =>
  button(
    action,
    icon(name),
    "icon-button icon-only",
    `aria-label='${label}' title='${label}' ${disabled ? "disabled" : ""}`,
  );
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
function save(key, value) {
  try {
    localStorage.setItem("sokan." + key, JSON.stringify(value));
    return true;
  } catch {
    toast("保存できませんでした");
    return false;
  }
}
function toast(text) {
  $("#toast").textContent = text;
  $("#toast").classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("#toast").classList.remove("show"), 3000);
}
const se = new Sounds();
let sound = read("sound", true),
  numbers = read("numbers", false),
  level = read("level", "normal");
if (!levels[level]) level = "normal";
se.enabled = sound;
let records = read("records", []);
if (!Array.isArray(records)) records = [];
records = records.filter((r) => r && Array.isArray(r.moves));
let game = {
  id: crypto.randomUUID(),
  moves: [],
  level,
  result: null,
  started: Date.now(),
  assisted: false,
};
try {
  const draft = read("draft", null);
  if (draft) {
    const r = validateRecord({ ...draft, rule: "freestyle15" });
    if (r.result === "unfinished") game = { ...r, result: null };
    else {
      game = r;
      if (!records.some((item) => item.id === r.id))
        records.push(structuredClone(r));
    }
  }
} catch {}
let archivePending = !!game.result,
  pendingNewAction = null;
let engineState = "loading",
  engine = null,
  cpuBusy = false,
  cpuError = null,
  cpuToken = 0,
  hint = null,
  hintBusy = false;
let titleVisible = true,
  mode = read("view-v2", "guide");
if (!["guide", "learn", "play", "review"].includes(mode)) mode = "guide";
let strategyMounted = false;
let strategyObserver = null;
const strategySeen = new Set();
let progress = createLearningProgress(read("learning-v2", null));
let learning = restoreLearningAttempt(read("learning-attempt-v2", null));
let pathProgress = createPathProgress(
  read("learning-path-v3", null),
  progress,
  { curriculumVersion: "path-2026-11-11" },
);
let learningRole = "lesson",
  journey = recoverJourney(read("journey-v3", null)),
  journeyBusy = false,
  journeyError = null,
  journeyEpoch = 0;
let journeyHelpKey = null;
let practiceGames = read("practice-games-v3", []);
if (!Array.isArray(practiceGames)) practiceGames = [];
let examSeries = read("exam-series-v3", null);
let playTrace = game.trace
  ? recoverJourney(game.trace)
  : !game.moves.length
    ? createJourney("practice", { attemptId: game.id })
    : null;
if (!game.moves.length && !game.result) attachGameEvidence(game);
delete game.trace;

let learnScreen = learning?.status === "choose" ? "practice" : "library",
  learnSection = "lessons",
  unitId = units[0]?.id,
  demoStep = 0,
  lessonReplay = null,
  problemQueue = [],
  queueIndex = 0;
let review = null,
  reviewScreen = "library",
  reviewStep = 0,
  moments = [],
  momentIndex = 0,
  reviewPhase = "advice",
  reviewFrame = 0,
  reviewRetry = null,
  reviewScan = { state: "idle", done: 0, total: 0 },
  reviewWorker = null,
  reviewJob = 0;
const reviewCache = new Map();
const shownReviewBoards = new Set();
const pending = { play: null, learn: null, review: null };
let demoReturn = false,
  lessonTarget = null,
  reviewTargetPly = null;
let precisionCenter = 112,
  lastPanelKey = "",
  lastLibraryKey = "";
let lastQuestionView = null;
const savedRoute = read("learning-route-v2", null);
if (learning) {
  const validQueue = savedRoute?.problemQueue?.filter((id) =>
    problems.some((p) => p.id === id),
  );
  problemQueue = validQueue?.includes(learning.problemId)
    ? validQueue
    : [learning.problemId];
  queueIndex = problemQueue.indexOf(learning.problemId);
  learningRole =
    savedRoute?.role === "assessment" &&
    problems.find((p) => p.id === learning.problemId)?.role === "assessment"
      ? "assessment"
      : "lesson";
  if (["lessons", "mixed", "retry", "games"].includes(savedRoute?.section))
    learnSection = savedRoute.section;
}

const emptyFrame = () => ({
  board: Array(225).fill(0),
  last: null,
  title: "",
  text: "",
  highlights: [],
  history: [],
});
const currentProblem = () => problems.find((p) => p.id === learning?.problemId);
const independentQuestion = () =>
  learningRole === "assessment" &&
  !!learning &&
  !learning.guidanceSeen &&
  !learning.hints.uses &&
  !learning.metrics.verifiedMistakes &&
  !learning.metrics.unknownSelections &&
  !learning.metrics.retries &&
  !pathProgress.attempts[learning.attemptId]?.exposureSeen;
const currentUnit = () =>
  units.find((u) => u.id === (currentProblem()?.unitId || unitId)) || units[0];
const libraryVisible = () =>
  mode === "learn"
    ? learnScreen === "library"
    : mode === "review" && reviewScreen === "library";
function skin() {
  return boardSkin({
    mode,
    level,
    gameLevel: game.level,
    started: game.moves.length > 0,
    reviewLevel: review?.level,
  });
}
function present(s) {
  return skinText(s || "", skin());
}
function openModal(html) {
  $("#modal-body").innerHTML = html;
  const h = $("#modal-body h2");
  if (h) {
    h.id = "modal-title";
    $("#modal").setAttribute("aria-labelledby", "modal-title");
  }
  if (!$("#modal").open) $("#modal").showModal();
}
function closeModal() {
  $("#modal").close();
}
function saveGame() {
  save("draft", game.result ? null : { ...game, trace: playTrace });
}
function saveLearning() {
  if (learning) {
    progress = recordLearningAttempt(progress, learning);
    const p = currentProblem();
    pathProgress = recordAttemptEvidence(pathProgress, learning, {
      role: learningRole,
      at: nowISO(),
      unitId: p.unitId,
      skillId: p.skillId || p.unitId,
      family: p.family,
      board: p.board,
      branchId: p.branchId || `${p.id}:${learning.replyVariant}`,
      requiresBranch: p.requiresBranch ?? false,
    });
    save("learning-path-v3", pathProgress);
  }
  save("learning-v2", progress);
  save("learning-attempt-v2", learning);
  save("learning-route-v2", {
    problemQueue,
    section: learnSection,
    role: learningRole,
  });
}
function updateLoading(state, progress = null) {
  if (!$("#title-screen")) return;
  const ready = state === "ready",
    failed = state === "error";
  let value = ready
    ? 100
    : progress
      ? Math.round(progress.percent || 0)
      : state === "loading"
        ? 0
        : Number($("#loading-progress").getAttribute("aria-valuenow")) || 0;
  value = Math.max(0, Math.min(100, value));
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
  $("#loading-progress").setAttribute("aria-valuenow", String(value));
  $("#loading-label").textContent = failed
    ? "読み込めませんでした"
    : ready
      ? "準備完了"
      : preparing
        ? "準備中"
        : "読み込み中";
  $("#title-start").disabled = !ready;
  $("#title-start").hidden = failed;
  $("#title-retry").hidden = !failed;
}
function dismissTitle(destination) {
  titleVisible = false;
  $("#title-screen").hidden = true;
  document.body.classList.remove("title-visible");
  $(".shell").inert = false;
  $(".shell").removeAttribute("aria-hidden");
  if (destination) {
    if (destination === "guide") markLiveHelp("strategy-guide");
    mode = destination;
    save("view-v2", mode);
  }
  render();
  if (mode === "play") cpuTurn();
}
function syncViewport() {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    navigator.standalone === true;
  document.documentElement.style[
    standalone && innerWidth <= 600 ? "setProperty" : "removeProperty"
  ]("--available-app-height", `${innerHeight}px`);
}
function rememberFocus() {
  const e = document.activeElement;
  if (!e || e === document.body) return null;
  for (const a of [
    "data-cell",
    "data-action",
    "data-unit",
    "data-problem",
    "data-record",
  ])
    if (e.hasAttribute(a)) return `[${a}='${CSS.escape(e.getAttribute(a))}']`;
  return e.id ? "#" + CSS.escape(e.id) : null;
}
function restoreFocus(selector) {
  if (titleVisible || $("#modal").open || !selector) return;
  const e = $(selector);
  if (
    e &&
    !e.disabled &&
    !e.closest("[hidden]") &&
    document.activeElement !== e
  )
    e.focus({ preventScroll: true });
}
let selectedReviewPattern = null;
function rawFrame() {
  if (mode === "play")
    return {
      board: Array.from(boardFrom(game.moves)),
      last: game.moves.at(-1)?.i ?? null,
      history: game.moves,
      highlights: hint?.highlights || [],
    };
  if (mode === "learn") {
    if (learnScreen === "journey" && journey) {
      const v = getJourneyView(journey),
        preview =
          journeyHelpShown() && pending.learn !== null
            ? previewJourneyMove(journey, pending.learn)
            : null;
      return {
        board: v.board,
        last: v.last,
        history: v.moves.slice(journey.startPly).map((i) => ({ i })),
        highlights:
          v.completed || v.turn !== 1 || journeyHelpShown()
            ? preview?.highlights || v.highlights
            : [],
      };
    }
    if (learnScreen === "demo") {
      const frames = getDemoFrames(unitId);
      return frames[Math.min(demoStep, frames.length - 1)] || emptyFrame();
    }
    if (lessonReplay)
      return lessonReplay.frames[lessonReplay.step] || emptyFrame();
    if (learning) {
      const v = getLearningView(learning);
      return { ...v, history: learning.history };
    }
    return emptyFrame();
  }
  if (!review) return emptyFrame();
  if (reviewRetry) return reviewRetry.frame;
  if (reviewScreen === "moment" && moments.length) {
    const m = moments[momentIndex];
    if (reviewPhase === "advice") return m.coach;
    const frames = reviewPhase === "better" ? m.improvementFrames : m.frames;
    return (
      frames?.[Math.min(reviewFrame, (frames?.length || 1) - 1)] || {
        board: m.before,
        last: null,
        highlights: [],
        title: m.title,
        text: m.text,
      }
    );
  }
  const moves = review.moves.slice(0, reviewStep);
  const b = boardFrom(moves);
  let description = {};
  if (moves.length) {
    try {
      description =
        describeMove(
          boardFrom(moves.slice(0, -1)),
          moves.at(-1).i,
          ((moves.length - 1) % 2) + 1,
        )?.at(-1) || {};
    } catch {}
  }
  return {
    board: Array.from(b),
    last: moves.at(-1)?.i ?? null,
    history: moves,
    title:
      moments.find((m) => m.ply === reviewStep)?.coach?.title ||
      description.title ||
      `${reviewStep}手目`,
    text:
      moments.find((m) => m.ply === reviewStep)?.coach?.text ||
      (description.text === "五の完成点なし" ? "" : description.text || ""),
    motifs: description.motifs || [],
    highlights: description.highlights || [],
  };
}
function getFrame() {
  const f = rawFrame();
  if (mode !== "review" || reviewRetry?.status === "choose") return f;
  const motif =
    f.motifs?.find((p) => p.id === selectedReviewPattern) || f.motifs?.[0];
  const switched =
    motif && selectedReviewPattern === motif.id && f.motifs[0]?.id !== motif.id;
  return {
    ...f,
    selectedMotif: motif,
    title: switched
      ? `${motif.color === 1 ? "黒" : "白"}の${motif.name}`
      : f.title,
    text: switched ? motif.text + (motif.caution || "") : f.text,
    highlights: motif ? patternHighlights(motif, f.board) : f.highlights || [],
  };
}
function reviewFrames() {
  const m = moments[momentIndex];
  return (
    reviewRetry?.frames ||
    (reviewPhase === "advice"
      ? [m?.coach]
      : reviewPhase === "better"
        ? m?.improvementFrames
        : m?.frames) ||
    []
  );
}
function canPlace() {
  if (mode === "guide") return false;
  if (mode === "play")
    return (
      engineState === "ready" &&
      !cpuBusy &&
      !hintBusy &&
      !journeyBusy &&
      !engine?.pending &&
      !game.result &&
      game.moves.length % 2 === 0
    );
  if (mode === "learn" && learnScreen === "journey")
    return (
      journey?.status === "playing" &&
      !journeyBusy &&
      !cpuBusy &&
      !hintBusy &&
      !engine?.pending &&
      engineState === "ready"
    );
  if (mode === "learn")
    return (
      learnScreen === "practice" &&
      !lessonReplay &&
      learning &&
      getLearningView(learning).canPlace
    );
  return !!reviewRetry && reviewRetry.status === "choose";
}
function switchMode(next) {
  if (next === mode) return;
  if (mode === "learn") {
    journeyHelpKey = null;
    if (
      learnScreen === "demo" ||
      (learnScreen === "practice" &&
        (lessonReplay || learning?.status !== "choose"))
    ) {
      learnScreen = "library";
      lessonReplay = null;
    }
  }
  if (mode === "guide") saveStrategyScroll();
  if (next === "guide") markLiveHelp("strategy-guide");
  if (mode === "review" && reviewScan.state === "running")
    reviewAutoOpen = false;
  closeModal();
  mode = next;
  save("view-v2", mode);
  render();
  if (mode === "play") cpuTurn();
  if (mode === "learn" && learnScreen === "journey") journeyReply();
}
function statusText() {
  if (mode === "play")
    return game.result
      ? {
          win: "あなたの勝ち",
          loss: "CPUの勝ち",
          draw: "引き分け",
          resign: "投了",
        }[game.result]
      : cpuError
        ? "CPUが応答していません"
        : cpuBusy
          ? "CPUが考えています"
          : hintBusy
            ? "ヒントを考えています"
            : engineState === "error"
              ? "読み込みに失敗しました"
              : journeyBusy
                ? "CPUの応手待ち"
                : engineState !== "ready"
                  ? "準備中"
                  : game.moves.length % 2
                    ? "CPUの番"
                    : pending.play !== null
                      ? `${coord(pending.play)}を選択中`
                      : "あなたの番";
  if (mode === "learn" && learnScreen === "journey")
    return journeyError || engineState === "error"
      ? "CPUが応答していません"
      : journey?.completed
        ? journey.winner === 1
          ? "あなたの勝ち"
          : journey.winner === 2
            ? "CPUの勝ち"
            : "引き分け"
        : journeyBusy
          ? "CPUが考えています"
          : journey?.turn === 2
            ? "CPUの番"
            : engineState === "ready"
              ? "あなたの番"
              : "準備中";
  if (mode === "learn")
    return learnScreen === "demo"
      ? "見本"
      : lessonReplay
        ? "手順を確認"
        : learning?.status === "solved"
          ? "できた"
          : learning?.status === "feedback"
            ? "答え合わせ"
            : learning &&
                currentProblem()?.questionHighlights &&
                getLearningView(learning).input === "choice"
              ? "予測する"
              : "黒の番";
  return reviewRetry
    ? "同じ局面で試す"
    : reviewScan.state === "running"
      ? `確認中 ${reviewScan.done}/${reviewScan.total}`
      : reviewScreen === "moment"
        ? `${moments[momentIndex]?.ply ?? 1}手目`
        : `${reviewStep}/${review?.moves.length || 0}手`;
}
function render() {
  if (mode !== "learn" || learnScreen !== "journey") journeyHelpKey = null;
  const questionView =
    mode === "learn" &&
    learnScreen === "practice" &&
    !lessonReplay &&
    learning?.status === "choose"
      ? `${learning.attemptId}:${learning.nodeId}:${learning.history.length}`
      : null;
  if (questionView && questionView !== lastQuestionView)
    learning = hideLearningHints(learning);
  lastQuestionView = questionView;
  const focus = rememberFocus();
  document.body.dataset.mode = mode;
  document.body.dataset.skin = skin();
  document.body.dataset.screen =
    mode === "guide" ? "guide" : libraryVisible() ? "library" : "board";
  $$(".nav[data-mode]").forEach((b) => {
    const on = b.dataset.mode === mode;
    b.classList.toggle("active", on);
    b.setAttribute("aria-current", on ? "page" : "false");
  });
  $("#mode-label").textContent = {
    guide: "攻略書",
    play: "対局",
    learn: "学ぶ",
    review: "振り返り",
  }[mode];
  $("#sound").innerHTML = icon(sound ? "sound" : "mute");
  $("#sound").setAttribute(
    "aria-label",
    sound ? "効果音をオフ" : "効果音をオン",
  );
  $("#sound").setAttribute("aria-pressed", String(sound));
  $(".new-top-button").hidden = mode !== "play";
  $("#arena").hidden = libraryVisible() || mode === "guide";
  $("#library-view").hidden = !libraryVisible();
  $("#strategy-view").hidden = mode !== "guide";
  if (mode === "guide") {
    renderStrategy();
    $("#context-bar").innerHTML = "";
    $("#context-bar").hidden = true;
  } else if (libraryVisible()) {
    renderLibrary();
    $("#context-bar").innerHTML = "";
    $("#context-bar").hidden = true;
  } else {
    $("#context-bar").hidden = false;
    const heading =
      mode === "learn"
        ? learnScreen === "journey"
          ? getJourneyView(journey).title
          : learnScreen === "demo"
            ? units.find((u) => u.id === unitId)?.title
            : learningRole === "assessment"
              ? independentQuestion()
                ? "確認問題"
                : "復習問題"
              : learnSection === "mixed"
                ? "問題練習"
                : currentUnit()?.title
        : mode === "review"
          ? "振り返り"
          : "";
    $("#context-bar").innerHTML =
      mode === "play"
        ? `<span class='context-status' role='status'><i class='status-dot ${cpuBusy ? "busy" : ""}'></i>${esc(present(statusText()))}</span><button class='opponent-pill' data-action='match-menu'>${esc(levels[game.moves.length ? game.level : level].label)}${game.exam ? ` · 挑戦 ${Math.min(examState().attempts, 10)}/10` : ""} <strong>CPU</strong> ${esc(stoneName(skin(), 2))}</button>`
        : `${ib(mode === "learn" ? "learn-library" : "review-library", "chevron-left", mode === "learn" ? "教材一覧" : "対局一覧")}<strong class='context-title'>${esc(heading)}</strong><span class='context-status' role='status'>${esc(statusText())}</span>`;
    if (mode === "review") {
      const f = getFrame();
      if (f.selectedMotif) {
        const p = f.selectedMotif,
          verb =
            p.purpose === "aim"
              ? "狙う"
              : p.purpose === "prevent"
                ? "防ぐ"
                : p.color === 1
                  ? "自分"
                  : "相手";
        const node = $("#context-bar .context-title");
        if (node)
          node.outerHTML = `<button class='context-title pattern-trigger ${p.color === 1 ? "good" : "danger"}' data-action='review-patterns'>${esc(verb + (p.purpose ? "型：" : "の型：") + p.name)} ${icon("chevron-right")}</button>`;
      }
    }
    const displayFrame = getFrame();
    if (mode === "review" && reviewRetry?.status !== "choose") {
      const key = displayFrame.board.join("");
      if (!shownReviewBoards.has(key)) {
        shownReviewBoards.add(key);
        pathProgress = noteExposure(pathProgress, {
          board: displayFrame.board,
          unitId: displayFrame.selectedMotif?.skillId,
          kind: "review",
          at: nowISO(),
        });
        savePath();
      }
    }
    renderBoard(displayFrame, {
      skin: skin(),
      numbers,
      pending: canPlace() ? pending[mode] : null,
    });
    renderControls();
    renderPanel();
  }
  restoreFocus(focus);
}
function renderStrategy() {
  const el = $("#strategy-view");
  if (!strategyMounted) {
    el.innerHTML = strategyMarkup();
    strategyMounted = true;
    const stored = read("strategy-scroll-v1", 0);
    const y = typeof stored === "number" ? stored : stored?.y;
    if (stored?.tocOpen === false) el.querySelector(".guide-toc").open = false;
    if (Number.isFinite(y) && y > 0) el.scrollTop = y;
    el.addEventListener("click", (event) => {
      if (event.target.closest(".guide-toc a"))
        el.querySelector(".guide-toc").open = false;
    });
    el.querySelectorAll("[data-guide-record]").forEach((node) =>
      node.addEventListener("toggle", () => {
        if (!node.open || mode !== "guide" || titleVisible) return;
        const key = `record:${node.dataset.guideRecord}`;
        if (strategySeen.has(key)) return;
        strategySeen.add(key);
        for (const exposure of strategyRecordExposures(
          node.dataset.guideRecord,
        )) {
          progress = recordBoardExposure(progress, exposure.board);
          pathProgress = noteExposure(pathProgress, {
            ...exposure,
            at: nowISO(),
          });
        }
        save("learning-v2", progress);
        savePath();
      }),
    );
  }
  if (titleVisible || strategyObserver) return;
  strategyObserver = new IntersectionObserver(
    (entries) => {
      if (mode !== "guide" || titleVisible) return;
      let changed = false;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const node = entry.target;
        const key = `${node.dataset.guideDiagram}:${node.dataset.guideStep}`;
        if (strategySeen.has(key)) continue;
        const exposure = strategyExposure(
          node.dataset.guideDiagram,
          Number(node.dataset.guideStep),
        );
        if (!exposure) continue;
        strategySeen.add(key);
        progress = recordBoardExposure(progress, exposure.board);
        pathProgress = noteExposure(pathProgress, {
          ...exposure,
          at: nowISO(),
        });
        changed = true;
      }
      if (changed) {
        save("learning-v2", progress);
        savePath();
      }
    },
    { root: el, threshold: 0.1 },
  );
  el.querySelectorAll("[data-guide-diagram]").forEach((node) =>
    strategyObserver.observe(node),
  );
}
function saveStrategyScroll() {
  if (strategyMounted)
    save("strategy-scroll-v1", {
      y: $("#strategy-view").scrollTop,
      tocOpen: $("#strategy-view .guide-toc").open,
    });
}
window.addEventListener("pagehide", () => {
  if (mode === "guide") saveStrategyScroll();
});
function recoverJourney(raw) {
  if (!raw) return null;
  try {
    return restoreJourney(raw);
  } catch {
    return null;
  }
}
function journeyHelpShown() {
  return (
    !!journey && journeyHelpKey === `${journey.id}:${journey.moves.length}`
  );
}
function nowISO() {
  return (
    new Date(Date.now() + 9 * 3600000).toISOString().slice(0, -1) + "+09:00"
  );
}
function savePath() {
  save("learning-path-v3", pathProgress);
}
function gameSettings(which = level) {
  return {
    rule: "freestyle15",
    level: which,
    strength: levels[which].strength,
    timeMs: levels[which].ms,
  };
}
function attachGameEvidence(g) {
  g.rule = "freestyle15";
  g.role = g.exam ? "exam" : "practice";
  g.startBoard = Array(225).fill(0);
  g.startSettings = gameSettings(g.level);
  g.settings = { ...g.startSettings };
}
function markLiveHelp(kind) {
  if (learningRole === "assessment" && learning?.status === "choose") {
    learning = markLearningGuidance(learning);
    saveLearning();
  }
  if (
    journey &&
    !journey.completed &&
    !journey.assisted &&
    journey.moves.length > journey.startPly
  ) {
    journey = markJourneyAssistance(journey, kind);
    saveJourney();
  }
  if (game.result || (!game.moves.length && kind !== "hint")) return;
  game.assisted = true;
  if (playTrace) playTrace = markJourneyAssistance(playTrace, kind);
  saveGame();
  recordGameEvidence();
}
function exposeLesson(id) {
  const frames = getDemoFrames(id),
    frame = frames[demoStep];
  for (const f of [frames[0], frame])
    if (f)
      pathProgress = noteExposure(pathProgress, {
        unitId: id,
        board: f.board,
        kind: "demo",
        at: nowISO(),
      });
  savePath();
  markLiveHelp("lesson");
}
function exposeCurrent(kind) {
  const p = currentProblem();
  if (!p) return;
  pathProgress = noteExposure(pathProgress, {
    unitId: p.unitId,
    problemId: p.id,
    family: p.family,
    board: p.board,
    kind,
    at: nowISO(),
  });
  savePath();
}
function recommendedStep(id = null) {
  return nextLearningStep(pathProgress, {
    units,
    assessmentProblems,
    unitId: id,
    at: nowISO(),
  });
}
function goRecommended(id = null) {
  const step = recommendedStep(id);
  if (
    learningRole === "assessment" &&
    learning?.status === "choose" &&
    (step.kind === "assessment" ||
      step.kind === "assessment-unavailable" ||
      (step.reason === "assessment-exhausted" &&
        !currentProblem()?.assessmentDomain)) &&
    step.reason !== "review-transfer" &&
    (!step.assessmentDomain ||
      step.assessmentDomain === currentProblem()?.assessmentDomain) &&
    step.unitId === currentProblem()?.unitId
  ) {
    mode = "learn";
    learnScreen = "practice";
    lessonReplay = null;
    render();
    return;
  }
  if (step.kind === "review") {
    if (
      journey &&
      !journey.completed &&
      journey.config.sourceReview?.recordId === step.recordId &&
      journey.config.sourceReview?.ply === step.ply
    ) {
      mode = "learn";
      learnScreen = "journey";
      learnSection = "games";
      lessonReplay = null;
      render();
      journeyReply();
      return;
    }
    const r =
      records.find((r) => r.id === step.recordId) ||
      practiceGames.find((r) => r.id === step.recordId) ||
      (game.id === step.recordId ? game : null);
    if (r) {
      loadReview(r, step.ply);
      return;
    }
    toast("元の棋譜が見つかりません");
    return;
  }
  mode = "learn";
  save("view-v2", mode);
  learnSection = "lessons";
  if (step.kind === "assessment-unavailable") {
    showAssessmentUnavailable(step);
    return;
  }
  if (step.kind === "assessment") {
    startAssessment(step.unitId, step.phase || "initial");
    return;
  }
  if (step.kind === "lesson") {
    if (!unitStatus(pathProgress, step.unitId).viewed) {
      openUnit(step.unitId, false, step.problemId);
      return;
    }
    const u = units.find((u) => u.id === step.unitId);
    startProblem(step.problemId, { queue: [step.problemId], role: "lesson" });
    return;
  }
  if (step.reason === "assessment-exhausted") {
    startJourney("practice", { white: practiceLevelFor(step.unitId) });
    return;
  }
  if (step.reason === "initial-complete") {
    if (examState().challengeCompleted) {
      learnSection = "games";
      learnScreen = "library";
      render();
      return;
    }
    startGuidedNext();
    return;
  }
  learnSection = "games";
  learnScreen = "library";
  render();
}
function startGuidedNext() {
  const sources = Object.values(pathProgress.practicalResults || {}).map(
    (r) => r.source,
  );
  const finished = sources.filter((r) => r.completed && r.role === "journey");
  const achieved = (r) =>
    new Set(
      (r.opportunities || [])
        .filter((o) => !o.retracted && o.outcome === "achieved")
        .map((o) => o.objectiveId),
    );
  const hasGoals = (r, ids) => ids.every((id) => achieved(r).has(id));
  const goals = (track) =>
    new Set(
      finished
        .filter((r) => r.trackId === track)
        .flatMap((r) => [...achieved(r)]),
    );
  const builds = finished.filter(
      (r) =>
        r.trackId === "build" &&
        r.fromOpening === true &&
        r.startPly === 0 &&
        r.result === "win",
    ),
    buildGoals = [
      "two-directions",
      "build-threat",
      "force-four",
      "finish-five",
    ],
    defended = goals("defend");
  if (!builds.some((r) => hasGoals(r, buildGoals))) {
    startJourney("build");
    return;
  }
  if (!builds.some((r) => hasGoals(r, [...buildGoals, "switch-direction"]))) {
    const completedBranch = (axis) =>
      finished.some(
        (r) =>
          r.trackId === "branch" &&
          r.origin === "position" &&
          r.startPly === 8 &&
          r.fromOpening === false &&
          r.sourceProblemId === "two-direction-fork" &&
          r.result === "win" &&
          r.white?.kind === "teaching-branch" &&
          r.branchOverride?.blockedAxes?.includes(axis) &&
          hasGoals(r, ["switch-direction", "force-four", "finish-five"]) &&
          (r.opportunities || []).some(
            (o) =>
              !o.retracted &&
              o.outcome === "achieved" &&
              o.objectiveId === "switch-direction" &&
              o.ply > r.branchOverride.ply &&
              o.evidence?.reply === r.branchOverride.move &&
              o.evidence?.scope === "blocked-open-three-then-other-four" &&
              o.evidence?.blockedAxes?.includes(axis),
          ),
      );
    for (const variants of [
      ["E8", "I8"],
      ["H9", "H5"],
    ]) {
      const axis = variants[0] === "E8" ? 0 : 1;
      if (completedBranch(axis)) continue;
      const attempts = sources.filter(
        (r) =>
          r.trackId === "branch" &&
          r.role === "journey" &&
          variants.includes(r.replyVariant),
      ).length;
      startJourney("branch", {
        replyVariant: variants[attempts % variants.length],
      });
      return;
    }
  }
  if (!(
    defended.has("recover-after-defense") &&
    (defended.has("stop-five") || defended.has("prevent-fork"))
  )) {
    startJourney("defend", {
      initialMoves: positionMoves(
        problems.find((p) => p.id === "prevent-junction").board,
      ),
    });
    return;
  }
  const games = Object.values(pathProgress.practicalResults || {}).filter(
    (r) => r.eligibleFullGame && r.source.result === "win",
  );
  if (games.filter((r) => r.source.level === "normal").length < 2) {
    startJourney("practice", { white: levels.normal });
    return;
  }
  if (games.filter((r) => r.source.level === "strong").length < 2) {
    startJourney("practice", { white: levels.strong });
    return;
  }
  startExam();
}
function practiceLevelFor(id) {
  const i = units.findIndex((u) => u.id === id);
  return i < 3 ? levels.normal : i < 6 ? levels.strong : levels.max;
}
function startAssessment(id, phase = "initial") {
  const p = selectAssessment(pathProgress, id, assessmentProblems, {
    phase,
    at: nowISO(),
  });
  if (!p) {
    if (
      learningRole === "assessment" &&
      learning?.status === "choose" &&
      currentProblem()?.unitId === id
    ) {
      mode = "learn";
      learnScreen = "practice";
      lessonReplay = null;
      render();
      return;
    }
    const availability = assessmentAvailability(
      pathProgress,
      id,
      assessmentProblems,
      { phase, at: nowISO() },
    );
    if (availability.reason === "domain-exhausted") {
      showAssessmentUnavailable(availability);
      return;
    }
    if (availability.state === "complete") {
      learnScreen = "library";
      render();
      return;
    }
    if (
      phase === "retention" &&
      Date.now() -
        Date.parse(
          unitStatus(pathProgress, id).coverageInitialAt ||
            unitStatus(pathProgress, id).initialAt ||
            nowISO(),
        ) <
        86400000
    ) {
      learnScreen = "library";
      render();
      toast("保持確認は24時間以上あけて行います");
      return;
    }
    startJourney("practice", { white: practiceLevelFor(id) });
    return;
  }
  learnSection = "lessons";
  startProblem(p.id, { queue: [p.id], role: "assessment", variant: 0 });
}
function pathCard() {
  const step = recommendedStep(),
    u = units.find((u) => u.id === step.unitId);
  const confirmed = units.filter(
    (x) => unitStatus(pathProgress, x.id).currentConfirmed,
  ).length;
  const reached =
    step.reason === "initial-complete" && examState().challengeCompleted;
  return `<div class='path-next'><div><span class='lesson-kicker'>次の一歩 · 確認 ${confirmed}/${units.length}</span><h2>${esc(reached ? "最強10局全勝" : step.kind === "journey" ? "空盤から試す" : u?.title)}</h2></div>${button("path-next", reached ? "成績を見る" : step.label, "primary")}</div>`;
}
function showAssessmentUnavailable(step) {
  mode = "learn";
  learnScreen = "library";
  learnSection = "retry";
  const u = units.find((u) => u.id === step.unitId);
  const lesson = problems.find(
    (p) =>
      p.role === "lesson" &&
      p.unitId === step.unitId &&
      []
        .concat(p.teachesAssessmentDomain || [])
        .includes(step.assessmentDomain),
  );
  render();
  openModal(
    `<h2>${esc(u?.title || "確認")}</h2><p>新しい確認問題なし</p><div class='modal-actions'>${button("unavailable-practice", "同じ形を練習", "primary", `data-unit-id='${esc(step.unitId)}' data-problem-id='${esc(lesson?.id || "")}'`)}${button("unavailable-units", "他の単元へ")}</div>`,
  );
}
function examState() {
  const e = getExamStatus(pathProgress, { seriesId: examSeries });
  const active =
    game.exam &&
    !game.result &&
    game.seriesId === examSeries &&
    !!game.startSettings;
  return {
    ...e,
    active,
    failed: !!(
      e.losses ||
      e.draws ||
      e.resigned ||
      e.assisted ||
      e.invalid ||
      (e.unfinished && !active)
    ),
  };
}
function renderPracticeLibrary() {
  const e = examState();
  return `<div class='journey-list'>${journey ? button("journey-resume", "課題対局の続きへ", "primary") : ""}${journeyTracks.map((t) => `<button class='unit-card' data-action='journey-start' data-track='${t.id}'><span class='unit-copy'><strong>${esc(t.title)}</strong><span>${esc(t.goal)}</span></span>${icon("chevron-right")}</button>`).join("")}</div><section class='exam-card'><h2>最強10局チャレンジ</h2><div class='exam-record'><strong>${e.wins}勝</strong><span>${e.losses}敗 · ${e.draws}分 · ${e.resigned}投了</span><span>試行 ${e.attempts}/10</span></div>${e.unfinished ? `<span class='lesson-kicker'>未完了 ${e.unfinished}</span>` : ""}${e.assisted ? `<span class='lesson-kicker'>補助あり ${e.assisted}</span>` : ""}${e.invalid ? `<span class='lesson-kicker'>条件不一致 ${e.invalid}</span>` : ""}<p>${e.challengeCompleted ? "10局全勝" : e.failed || e.attempts >= 10 ? "今回の挑戦は未達" : "空盤・無補助で10局"}</p>${button("exam-start", e.active ? "対局に戻る" : e.failed || e.attempts >= 10 ? "新しい挑戦" : "挑戦する", "primary")}</section>${
    practiceGames.length
      ? `<h2 class='library-subtitle'>課題対局の履歴</h2><div class='record-list'>${practiceGames
          .slice(-8)
          .map(
            (r) =>
              `<button class='record-card' data-action='${r.result === "unfinished" && r.snapshot ? "practice-resume" : "practice-review"}' data-practice='${esc(r.id)}'><span class='unit-copy'><strong>${esc(journeyTracks.find((t) => t.id === r.trackId)?.title || "局面から続ける")}</strong><span>${r.startPly ? "局面から · " : ""}${r.moves.length}手 · ${{ win: "勝ち", loss: "負け", draw: "引分", unfinished: "途中" }[r.result] || "途中"}</span></span>${icon("review")}</button>`,
          )
          .join("")}</div>`
      : ""
  }`;
}
function saveJourney() {
  if (!journey) return;
  save("journey-v3", journey);
  const r = getJourneyResult(journey);
  const role =
      r.origin === "review"
        ? "recovery"
        : r.trackId === "practice" && r.fromOpening
          ? "practice"
          : "journey",
    lvl =
      r.white.strength === 100
        ? "max"
        : r.white.strength >= 80
          ? "strong"
          : "normal",
    cfg = {
      rule: "freestyle15",
      level: lvl,
      strength: r.white.strength,
      timeMs: r.white.ms,
    };
  pathProgress = recordPracticalResult(pathProgress, {
    ...r,
    role,
    rule: "freestyle15",
    level: lvl,
    startBoard: Array.from(boardFrom(journey.config.initialMoves)),
    startSettings: cfg,
    settings: cfg,
    at: nowISO(),
  });
  savePath();
}
function archiveJourney() {
  if (!journey) return;
  const r = getJourneyResult(journey);
  const item = {
    ...r,
    rule: "freestyle15",
    level:
      r.white.strength === 100
        ? "max"
        : r.white.strength >= 80
          ? "strong"
          : "normal",
    started: Date.now(),
    moves: r.moves.map((i) => ({ i })),
    snapshot: journey,
  };
  const i = practiceGames.findIndex((g) => g.id === r.id);
  if (i < 0) practiceGames.push(item);
  else practiceGames[i] = item;
  save("practice-games-v3", practiceGames);
  saveJourney();
}
function startJourney(trackId, options = {}) {
  const commit = () => {
    journeyHelpKey = null;
    if (trackId !== "practice" || options.sourceReview)
      markLiveHelp("guided-practice");
    if (journey) archiveJourney();
    const cancelOldJourney = journeyBusy;
    journeyEpoch++;
    if (cancelOldJourney && engine?.pending) engine.cancel();
    journeyBusy = false;
    journeyError = null;
    pending.learn = null;
    journey = createJourney(trackId, {
      attemptId: crypto.randomUUID(),
      ...options,
    });
    if (options.initialBlackMove != null)
      journey = playJourneyMove(journey, options.initialBlackMove);
    learnScreen = "journey";
    lessonReplay = null;
    mode = "learn";
    learnSection = "games";
    closeModal();
    saveJourney();
    save("view-v2", mode);
    render();
    if (journey.completed) archiveJourney();
    else journeyReply();
  };
  if (
    journey &&
    journey.moves.length > journey.startPly &&
    !journey.completed
  ) {
    openModal(
      `<h2>課題対局を切り替える？</h2><p>今の棋譜は履歴に残します。</p><div class='modal-actions'>${button("close-modal", "戻る")}${button("confirm-journey", "始める", "primary")}</div>`,
    );
    $('#modal-body [data-action="confirm-journey"]').onclick = commit;
  } else commit();
}
function resumePractice(id) {
  const r = practiceGames.find((r) => r.id === id),
    restored = recoverJourney(r?.snapshot);
  if (!restored) {
    if (r) loadReview(r);
    return;
  }
  const commit = () => {
    if (journey && journey.id !== id) archiveJourney();
    const cancel = journeyBusy;
    journeyEpoch++;
    journeyBusy = false;
    if (cancel && engine?.pending) engine.cancel();
    journey = restored;
    journeyError = null;
    mode = "learn";
    learnScreen = "journey";
    learnSection = "games";
    lessonReplay = null;
    pending.learn = null;
    closeModal();
    saveJourney();
    render();
    journeyReply();
  };
  if (
    journey &&
    !journey.completed &&
    journey.id !== id &&
    journey.moves.length > journey.startPly
  ) {
    openModal(
      `<h2>この課題対局を再開する？</h2><p>今の課題は履歴に残します。</p><div class='modal-actions'>${button("close-modal", "戻る")}${button("confirm-resume", "再開", "primary")}</div>`,
    );
    $('#modal-body [data-action="confirm-resume"]').onclick = commit;
  } else commit();
}
function startRecovery() {
  const m = moments[momentIndex];
  if (!m || !review) return;
  startJourney("defend", {
    initialMoves: review.moves.slice(0, m.ply - 1),
    sourceReview: { before: m.before, ply: m.ply, recordId: review.id },
    initialBlackMove: reviewRetry?.accepted ? reviewRetry.move : null,
    white: {
      ms: levels[review.level || "normal"].ms,
      strength: levels[review.level || "normal"].strength,
    },
  });
}
function putJourney(i) {
  if (!journey || journeyBusy || engine?.pending) return;
  const next = playJourneyMove(journey, i);
  if (next === journey) return;
  journeyHelpKey = null;
  journey = next;
  pending.learn = null;
  se.play("stone");
  saveJourney();
  if (journey.completed) {
    archiveJourney();
    se.play(journey.winner === 1 ? "win" : "lose");
  }
  render();
  if (!journey.completed) journeyReply();
}
async function journeyReply() {
  if (
    !journey ||
    !getJourneyView(journey).needsReply ||
    journeyBusy ||
    !engine?.ready ||
    engine.pending ||
    cpuBusy ||
    hintBusy
  )
    return;
  const id = journey.id,
    token = journeyEpoch,
    v = getJourneyView(journey);
  journeyBusy = true;
  journeyError = null;
  render();
  try {
    const prescribed = v.replyConfig.teachingMove ?? v.replyConfig.openingMove;
    const r =
      prescribed != null
        ? { i: prescribed }
        : await engine.search(journey.moves, v.replyConfig);
    if (token !== journeyEpoch || journey?.id !== id) return;
    journey = applyJourneyReply(journey, r.i);
    journeyBusy = false;
    saveJourney();
    se.play("stone");
    if (journey.completed) {
      archiveJourney();
      se.play(journey.winner === 1 ? "win" : "lose");
    }
  } catch (e) {
    if (token !== journeyEpoch) return;
    journeyBusy = false;
    journeyError = e.message === "cancelled" ? null : true;
  } finally {
    if (token === journeyEpoch) render();
    if (mode === "play") cpuTurn();
  }
}
function recordGameEvidence() {
  if (!game.startSettings) return;
  const goals = playTrace
    ? getJourneyResult(playTrace).opportunities.filter((o) => !o.retracted)
    : [];
  pathProgress = recordPracticalResult(pathProgress, {
    ...game,
    rule: "freestyle15",
    role: game.exam ? "exam" : "practice",
    result: game.result || "unfinished",
    at: nowISO(),
    settings: gameSettings(game.level),
    opportunities: goals,
  });
  savePath();
}
function storeReviewEvidence(record, findings) {
  pathProgress = recordReviewFindings(pathProgress, record, findings, {
    at: nowISO(),
  });
  const old = pathProgress.practicalResults?.[record.id]?.source;
  if (old) {
    const positive = findings
      .filter((m) => m.kind === "pattern-play")
      .map((m) => ({
        unitId: m.patternType === "double-plan" ? "prepare" : m.skillId,
        success: true,
        ply: m.ply,
        outcome: "achieved",
        source: "verified-pattern",
      }));
    const byKey = new Map(
      [...(old.opportunities || []), ...positive].map((o) => [
        `${o.unitId}:${o.ply}:${o.source || o.kind}`,
        o,
      ]),
    );
    pathProgress = recordPracticalResult(pathProgress, {
      ...old,
      opportunities: [...byKey.values()],
    });
  }
  savePath();
}
function startExam() {
  if (game.exam && !game.result) {
    switchMode("play");
    return;
  }
  const e = examState();
  const begin = () => {
    if (!examSeries || e.failed || e.attempts >= 10) {
      examSeries = crypto.randomUUID();
      save("exam-series-v3", examSeries);
    }
    level = "max";
    save("level", level);
    if (newGame() !== true) {
      pendingNewAction = startExam;
      return;
    }
    game.exam = true;
    game.seriesId = examSeries;
    attachGameEvidence(game);
    recordGameEvidence();
    saveGame();
    render();
  };
  if (game.moves.length && !game.result) {
    openModal(
      `<h2>チャレンジを始める？</h2><p>今の対局は途中の棋譜として残します。</p><div class='modal-actions'>${button("close-modal", "戻る")}${button("confirm-exam", "始める", "primary")}</div>`,
    );
    $('#modal-body [data-action="confirm-exam"]').onclick = () => {
      if (saveUnfinished() === false) {
        archiveFailure(begin);
        return;
      }
      closeModal();
      begin();
    };
  } else begin();
}
function renderLibrary() {
  const el = $("#library-view"),
    key = mode + ":" + learnSection,
    scroll = lastLibraryKey === key ? el.scrollTop : 0;
  lastLibraryKey = key;
  if (mode === "learn") {
    const section = `<div class='learning-sections' role='group' aria-label='学習メニュー'>${[
      ["lessons", "順に学ぶ"],
      ["games", "課題対局"],
      ["mixed", "問題練習"],
      ["retry", "復習"],
    ]
      .map(([id, label]) =>
        button(
          "learn-section",
          label,
          id === learnSection ? "active" : "",
          `data-section='${id}' aria-pressed='${id === learnSection}'`,
        ),
      )
      .join("")}</div>`;
    let content = "";
    if (learnSection === "lessons")
      content =
        pathCard() +
        `<div class='unit-list'>${units
          .map((u, j) => {
            const st = unitStatus(pathProgress, u.id);
            return `<button class='unit-card' data-unit='${u.id}'><span class='unit-number'>${String(j + 1).padStart(2, "0")}</span><span class='unit-copy'><strong>${esc(u.title)}</strong><span>${esc(u.goal)}</span></span><span class='unit-progress'>${esc(st.label)}</span>${icon("chevron-right")}</button>`;
          })
          .join("")}</div>`;
    else if (learnSection === "games") content = renderPracticeLibrary();
    else if (learnSection === "retry")
      content = `<div class='unit-list'>${
        units
          .filter((u) => {
            const st = unitStatus(pathProgress, u.id);
            return (
              st.needsReview ||
              st.practicalPending ||
              (st.initialConfirmed && !st.retained)
            );
          })
          .map((u) => {
            const st = unitStatus(pathProgress, u.id);
            const availability = assessmentAvailability(
              pathProgress,
              u.id,
              assessmentProblems,
              {
                phase: st.currentConfirmed ? "retention" : "initial",
                at: nowISO(),
              },
            );
            const eligible =
              st.currentConfirmed &&
              selectAssessment(pathProgress, u.id, assessmentProblems, {
                phase: "retention",
                at: nowISO(),
              });
            let action;
            if (
              learningRole === "assessment" &&
              learning?.status === "choose" &&
              currentProblem()?.unitId === u.id
            )
              action = button("learn-resume", "問題の続き", "primary");
            else if (
              availability.reason === "domain-exhausted" &&
              st.assessmentReview?.stage !== "remediation" &&
              !st.reviewPending
            )
              action = button(
                "unavailable-check",
                "確認は保留",
                "secondary",
                `data-unit-id='${u.id}' data-phase='${availability.phase}'`,
              );
            else if (st.reviewPending || st.assessmentReviewPending)
              action = button(
                "unit-next",
                recommendedStep(u.id).label,
                "primary",
                `data-unit-id='${u.id}'`,
              );
            else if (
              st.baselineConfirmed &&
              st.pendingAssessmentDomains?.length
            )
              action = button(
                "unit-next",
                "追加の確認へ",
                "primary",
                `data-unit-id='${u.id}'`,
              );
            else if (st.practicalPending)
              action = button(
                "unit-practical",
                "実戦で確認",
                "primary",
                `data-unit-id='${u.id}'`,
              );
            else if (eligible)
              action = button(
                "retention-check",
                "保持を確認",
                "primary",
                `data-unit-id='${u.id}'`,
              );
            else if (st.currentConfirmed) {
              const ready =
                Date.parse(st.coverageInitialAt || st.initialAt) + 86400000;
              action =
                Date.now() < ready
                  ? `<span class='retention-date'>${new Date(ready).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}から保持確認</span>`
                  : button(
                      "unit-practical",
                      "実戦で確認",
                      "primary",
                      `data-unit-id='${u.id}'`,
                    );
            } else
              action = button(
                "unit-check",
                "別問題で確認",
                "primary",
                `data-unit-id='${u.id}'`,
              );
            return `<div class='review-skill-card'><h2>${esc(u.title)}</h2><span>${esc(st.label)}</span><div class='stage-actions'>${button("unit-remedial", "練習へ", "secondary", `data-unit-id='${u.id}'`)}${action}</div></div>`;
          })
          .join("") ||
        `<div class='empty-state'><h2>復習はありません</h2>${button("path-next", "次の一歩へ", "primary")}</div>`
      }</div>`;
    else {
      const list = problems.filter(
        (p) => p.role !== "assessment" && p.unitId !== units[0]?.id,
      );
      content = `<div class='library-start'>${button("mixed-start", "練習する", "primary")}</div><div class='problem-list'>${list.map((p, j) => `<button class='problem-card' data-problem='${p.id}'><span class='unit-number'>${String(j + 1).padStart(2, "0")}</span><span class='unit-copy'><strong>問題 ${j + 1}</strong><span>${esc(p.goal)}</span></span>${icon("chevron-right")}</button>`).join("")}</div>`;
    }
    el.innerHTML = `<div class='library-head'><h1>学ぶ</h1>${learning ? button("learn-resume", learning.status === "choose" ? "問題の続き" : "前の答え合わせ", "secondary") : ""}</div>${section}${content}`;
  } else {
    const wins = records.filter((r) => r.result === "win").length,
      losses = records.filter((r) =>
        ["loss", "resign"].includes(r.result),
      ).length;
    el.innerHTML = `<div class='library-head'><h1>振り返り</h1>${button("import", icon("upload"), "icon-button", `aria-label='棋譜を読み込む'`)}</div><div class='record-summary'><span><b>${wins}</b>勝</span><span><b>${losses}</b>敗</span><span>${records.length}局</span></div>${game.moves.length ? button("review-current", "今の対局を見る", "secondary") : ""}<div class='record-list'>${
      records.length
        ? records
            .map((r, j) => ({ r, j }))
            .reverse()
            .map(
              ({ r, j }) =>
                `<button class='record-card' data-record='${j}'><span class='record-result ${r.result === "win" ? "won" : ""}'>${{ win: "勝ち", loss: "負け", resign: "投了", draw: "引分", unfinished: "途中" }[r.result] || "途中"}</span><span class='unit-copy'><strong>${levels[r.level]?.label || "普通"} · ${r.moves.length}手</strong><span>${new Date(r.finished || r.started || Date.now()).toLocaleDateString("ja-JP")}${r.assisted ? " · 補助あり" : ""}</span></span>${icon("chevron-right")}</button>`,
            )
            .join("")
        : `<div class='empty-state'>${icon("review")}<h2>まだ対局がありません</h2>${button("go-play", "対局する", "primary")}</div>`
    }</div>`;
  }
  el.scrollTop = scroll;
}
function progressLabel(s, total) {
  const n = s?.completedProblems ?? s?.completedProblemIds?.length ?? 0;
  return n ? `${Math.min(n, total)}/${total}` : "未挑戦";
}
function needsRetry(id) {
  const s = getLearningStats(progress, { problemId: id });
  return (
    s?.needsReview ??
    !!(
      (s?.verifiedMistakes || s?.assistedCompleted) &&
      !s?.cleanProblemIds?.includes(id)
    )
  );
}
function placeControl() {
  return pending[mode] !== null && canPlace()
    ? button(
        "place",
        `ここに置く · ${coord(pending[mode])}`,
        "primary place-button",
      )
    : `<span class='place-prompt'>${canPlace() ? "盤をタップ" : mode === "play" || learnScreen === "journey" ? esc(present(statusText())) : "答えを選ぶ"}</span>`;
}
function renderControls() {
  let html = "";
  if (mode === "play")
    html =
      ib(
        "undo",
        "undo",
        "一手戻す",
        !game.moves.length || !!game.result || cpuBusy || hintBusy || game.exam,
      ) +
      ib("hint", "hint", "ヒント", !canPlace() || game.exam) +
      placeControl() +
      ib("precision", "target", "盤面を拡大");
  else if (mode === "learn") {
    if (learnScreen === "journey" && journey) {
      const v = getJourneyView(journey);
      html =
        ib(
          "journey-retry",
          "undo",
          "課題の一手をやり直す",
          !v.canRetry || journeyBusy || v.completed,
        ) +
        (journeyTracks.find((t) => t.id === journey.trackId)?.unaided
          ? ""
          : ib(
              "journey-hint",
              "hint",
              "ヒント",
              journeyBusy || v.turn !== 1 || v.completed,
            )) +
        placeControl() +
        ib("precision", "target", "盤面を拡大");
    } else if (learnScreen === "demo") {
      const frames = getDemoFrames(unitId);
      html =
        ib("demo-prev", "chevron-left", "見本の前の手", demoStep === 0) +
        `<span class='place-prompt'>${demoStep + 1} / ${frames.length}</span>` +
        ib(
          "demo-next",
          "chevron-right",
          "見本の次の手",
          demoStep >= frames.length - 1,
        ) +
        ib("precision", "target", "盤面を拡大");
    } else if (lessonReplay)
      html =
        ib(
          "lesson-replay-prev",
          "chevron-left",
          "前の一手",
          lessonReplay.step === 0,
        ) +
        `<span class='place-prompt'>${lessonReplay.step + 1} / ${lessonReplay.frames.length}</span>` +
        ib(
          "lesson-replay-next",
          "chevron-right",
          "次の一手",
          lessonReplay.step >= lessonReplay.frames.length - 1,
        ) +
        ib("precision", "target", "盤面を拡大");
    else if (learning?.status === "choose") {
      const v = getLearningView(learning);
      html =
        v.input === "choice"
          ? `<div class='choice-controls'>${v.choices.map((c) => button("learning-choice", esc(c.title), "secondary", `data-choice='${esc(c.id)}'`)).join("")}</div>` +
            ib("precision", "target", "盤面を拡大")
          : ib("learning-hint", "hint", "段階ヒント", !v.canHint) +
            placeControl() +
            ib("precision", "target", "盤面を拡大");
    } else
      html =
        `<span class='place-prompt'>${learning?.status === "solved" ? "できた" : "答え合わせ"}</span>` +
        ib("precision", "target", "盤面を拡大");
  } else {
    if (reviewRetry?.status === "choose")
      html = placeControl() + ib("precision", "target", "盤面を拡大");
    else if (reviewScreen === "moment") {
      const frames = reviewFrames();
      html =
        ib("review-frame-prev", "chevron-left", "前の一手", reviewFrame === 0) +
        (reviewRetry
          ? `<span class='place-prompt'>${reviewFrame + 1} / ${frames.length || 1}</span>`
          : `<div class='review-phases'>${button("review-advice", "要点", reviewPhase === "advice" ? "active" : "", `aria-pressed='${reviewPhase === "advice"}'`)}${button("review-actual", "実戦", reviewPhase === "actual" ? "active" : "", `aria-pressed='${reviewPhase === "actual"}'`)}${button("review-better", "改善", reviewPhase === "better" ? "active" : "", `aria-pressed='${reviewPhase === "better"}'`)}</div>`) +
        ib(
          "review-frame-next",
          "chevron-right",
          "次の一手",
          reviewFrame >= frames.length - 1,
        ) +
        ib("precision", "target", "盤面を拡大");
    } else
      html =
        ib(
          "review-first",
          "skip-back",
          "最初の局面",
          reviewStep === (review ? reviewStartPly(review) : 0),
        ) +
        ib(
          "review-prev",
          "chevron-left",
          "一手戻る",
          reviewStep === (review ? reviewStartPly(review) : 0),
        ) +
        `<input id='review-slider' type='range' min='${review ? reviewStartPly(review) : 0}' max='${review?.moves.length || 0}' value='${reviewStep}' aria-label='棋譜の手数'>` +
        ib(
          "review-next",
          "chevron-right",
          "一手進む",
          reviewStep >= (review?.moves.length || 0),
        ) +
        ib(
          "review-last",
          "skip-next",
          "最後の局面",
          reviewStep >= (review?.moves.length || 0),
        );
  }
  $("#board-controls").innerHTML = html;
}
function renderPanel() {
  const frame = getFrame();
  let content = "",
    actions = "";
  if (mode === "play") {
    const recent = game.moves.slice(-6);
    content = `<div class='play-console'><div class='move-timeline'>${recent.map((m, j) => `<span><i class='tiny-stone ${(game.moves.length - recent.length + j) % 2 ? "white" : "black"}'></i>${coord(m.i)}</span>`).join("")}</div>`;
    if (game.result)
      content += `<div class='result-summary'><h2>${esc(statusText())}</h2><span>${game.moves.length}手</span></div>`;
    else if (cpuError || engineState === "error")
      content += `<div class='result-summary'><p>CPUが応答していません</p></div>`;
    else if (hint)
      content += `<h2 class='lesson-heading'>${esc(present(hint.title))}</h2><p class='lesson-copy'>${esc(present(hint.text))}</p>`;
    content += "</div>";
    actions = game.result
      ? button("review-current", "振り返る", "primary") +
        (game.exam
          ? button(
              "exam-next",
              getExamStatus(pathProgress, { seriesId: examSeries }).attempts >=
                10
                ? "挑戦結果"
                : "次の対局",
            )
          : button("new", "もう一局"))
      : cpuError || engineState === "error"
        ? button("retry-engine", "もう一度", "primary")
        : `<div class='difficulties' role='group' aria-label='CPUの強さ'>${Object.entries(
            levels,
          )
            .map(([id, l]) =>
              button(
                "level",
                l.label,
                "difficulty " +
                  ((game.moves.length ? game.level : level) === id
                    ? "active"
                    : ""),
                `data-level='${id}' aria-pressed='${(game.moves.length ? game.level : level) === id}' ${game.exam && !game.result ? "disabled" : ""}`,
              ),
            )
            .join("")}</div>`;
  } else if (mode === "learn") {
    if (learnScreen === "journey" && journey) {
      const v = getJourneyView(journey),
        preview =
          journeyHelpShown() && pending.learn !== null
            ? previewJourneyMove(journey, pending.learn)
            : null,
        r = getJourneyResult(journey);
      const note =
        preview ||
        (v.turn === 1 && !v.completed
          ? journeyHelpShown()
            ? v.instruction
            : { title: v.stage.title, text: v.goal }
          : v.feedback) ||
        {};
      content = `<div class='lesson-kicker'>${journey.origin === "review" ? "振り返りから継続" : journey.startPly ? "課題局面から" : "空盤から"} · ${r.white.strength === 100 ? "最強" : r.white.strength === 85 ? "強い" : r.white.strength === 35 ? "普通" : "練習CPU"}${journeyHelpShown() ? " · ヒント表示" : ""}</div><h2 class='lesson-heading'>${esc(v.completed ? statusText() : note.title || v.title)}</h2><p class='lesson-copy'>${esc(note.text || "")}</p><div class='journey-goals'>${v.objectives.map((o) => `<span class='${o.status === "achieved" ? "achieved" : ""}'>${o.status === "achieved" ? "✓" : v.completed && o.status === "not-observed" ? "—" : "○"} ${esc(o.title)}${v.completed && o.status === "not-observed" ? "（機会なし）" : ""}</span>`).join("")}</div>`;
      actions =
        journeyError || engineState === "error"
          ? button("journey-reply", "もう一度", "primary")
          : v.completed
            ? button("journey-inspect", "振り返る", "primary") +
              button("path-next", "次の一歩へ")
            : button("journey-objectives", "目標") +
              button("journey-inspect", "この局面を検討");
    } else if (learnScreen === "demo") {
      const u = units.find((u) => u.id === unitId),
        frames = getDemoFrames(unitId);
      content = `<h2 class='lesson-heading'>${esc(frame.title)}</h2><p class='lesson-copy'>${esc(frame.text)}</p><div class='step-dots' aria-label='見本の進み具合'>${frames.map((_, j) => `<span data-active='${j === demoStep}'></span>`).join("")}</div>`;
      actions = demoReturn
        ? button("demo-return", "問題に戻る", "primary")
        : button("unit-practice", "練習する", "primary") +
          button(
            "unit-check",
            "確認から試す",
            "secondary",
            `data-unit-id='${unitId}'`,
          );
    } else if (lessonReplay) {
      content = `<div class='lesson-kicker'>${lessonReplay.kind === "refutation" ? "相手の返し" : "手順の確認"}</div><h2 class='lesson-heading'>${esc(frame.title)}</h2><p class='lesson-copy'>${esc(frame.text)}</p>`;
      actions =
        lessonReplay.step < lessonReplay.frames.length - 1
          ? button("lesson-replay-next", "次の一手を見る", "primary")
          : lessonReplay.kind === "refutation"
            ? button("learning-retry", "もう一度考える", "primary")
            : button(
                "lesson-replay-close",
                learning.status === "solved"
                  ? "答え合わせへ"
                  : currentProblem()?.questionHighlights &&
                      learning.exercise &&
                      !learning.history.length
                    ? "元の盤で選ぶ"
                    : "次の手を考える",
                "primary",
              );
    } else if (learning) {
      const v = getLearningView(learning),
        f = v.feedback;
      content = `<div class='lesson-kicker'>${problemQueue.length > 1 ? `問題 ${queueIndex + 1}/${problemQueue.length}` : ""}</div><h2 class='lesson-heading'>${esc(f?.title || v.goal)}</h2><p class='lesson-copy'>${esc(f?.text || "")}</p>`;

      if (v.hintLevel)
        content += `<p class='lesson-copy hint-copy'>${esc(v.hintText || "印をつけた石から、次に四や五になる点を考えよう。")}</p><div class='hint-step'>ヒント ${v.hintLevel}</div>`;
      if (learning.status === "solved")
        actions =
          button(
            "learning-next",
            queueIndex + 1 < problemQueue.length ? "次の問題" : "次の一歩へ",
            "primary",
          ) +
          (learningRole !== "assessment" && hasLearningBranch()
            ? button("learning-branch", "別の受けを試す")
            : "");
      else if (learning.status === "feedback")
        actions =
          (v.refutationFrames.length
            ? button(
                "learning-refutation",
                currentProblem()?.questionHighlights && !learning.exercise
                  ? "図で確かめる"
                  : "相手の返しを見る",
                "primary",
              )
            : "") +
          (learningRole === "assessment"
            ? button("assessment-remedial", "ここを学ぶ")
            : button("learning-retry", "もう一度"));
      else
        actions =
          (v.input === "choice"
            ? button("learning-hint", "ヒント")
            : v.transitionFrames.length
              ? button(
                  "learning-transition",
                  currentProblem()?.questionHighlights &&
                    learning.exercise &&
                    !learning.history.length
                    ? "予測した手順を見る"
                    : "直前の応手を見る",
                )
              : "") + button("learning-demo", "見本を見る");
    }
  } else if (review) {
    if (reviewScreen === "moment" && moments.length) {
      const m = moments[momentIndex];
      content = `<div class='lesson-kicker'>場面 ${momentIndex + 1}/${moments.length}${reviewPhase === "advice" && m.kind !== "pattern-play" && !reviewRetry ? ` · 実戦${coord(m.actual)} → ${coord(m.coach.selectedMove)}` : ""}${reviewRetry ? (reviewRetry.status === "choose" ? " · 試し直し" : reviewRetry.accepted ? " · この手の続き" : reviewRetry.verdictStatus === "refuted" ? " · 相手の返し" : " · 選んだ手") : reviewPhase === "actual" && reviewFrame >= 2 ? " · 相手が使えた手順" : reviewPhase === "better" ? " · 改善した手順" : ""}</div><h2 class='lesson-heading'>${esc(present(reviewRetry?.title || frame.title || m.title))}</h2><p class='lesson-copy'>${esc(present((reviewRetry?.status === "choose" ? reviewRetry.text : frame.text) || reviewRetry?.text || m.text))}</p>`;

      if (reviewRetry?.status === "choose")
        actions = button("review-cancel-retry", "解説に戻る");
      else if (reviewRetry)
        actions =
          (reviewRetry.accepted
            ? button("review-continue", "ここから対局", "primary")
            : button("review-retry", "もう一度試す", "primary")) +
          button("review-related", "似た形を学ぶ");
      else
        actions =
          (reviewPhase === "advice"
            ? button("review-better", "手順で確かめる", "primary")
            : button("review-retry", "この局面で試す", "primary")) +
          button(
            "next-moment",
            "次の場面",
            "secondary",
            moments.length < 2 ? "disabled" : "",
          );
    } else {
      content = `<div class='lesson-kicker'>${reviewStep}手目</div><h2 class='lesson-heading'>${esc(present(frame.title))}</h2><p class='lesson-copy'>${esc(present(frame.text))}</p>`;
      if (reviewScan.state === "running")
        content += `<div class='scan-progress' role='status'>確認中 ${reviewScan.done}/${reviewScan.total}</div>`;
      else if (reviewScan.state === "error")
        content += `<p class='lesson-copy'>振り返りを確認できませんでした</p>`;
      else if (reviewScan.state === "done" && !moments.length)
        content += `<p class='lesson-copy'>具体的な勝ち筋を示せる場面は見つかりませんでした。</p>`;
      actions = moments.some((m) => m.ply === reviewStep)
        ? button("review-this-moment", "この手を比較する", "primary")
        : moments.length
          ? button("show-moments", "大事な場面を見る", "primary")
          : reviewScan.state === "running"
            ? button("cancel-scan", "確認を止める")
            : reviewScan.state === "done"
              ? button("go-play", "対局へ", "primary")
              : button("scan-review", "大事な場面を探す", "primary");
      actions += button(
        "export",
        icon("download"),
        "icon-button",
        `aria-label='棋譜を書き出す'`,
      );
    }
    if (reviewScreen === "moment" && !reviewRetry)
      actions += button("review-record", "全手を見る");
  }
  const key = [
    mode,
    learnScreen,
    learning?.problemId,
    learning?.status,
    lessonReplay?.kind,
    lessonReplay?.step,
    reviewScreen,
    momentIndex,
    reviewPhase,
    reviewFrame,
    reviewStep,
    !!reviewRetry,
  ].join(":");
  const oldScroll =
    key === lastPanelKey ? $("#panel-content")?.scrollTop || 0 : 0;
  lastPanelKey = key;
  $("#panel").innerHTML =
    `<div id='panel-content' class='panel-content'><div class='lesson-content'>${content}</div></div><div class='panel-actions'>${actions}</div>`;
  $("#panel-content").scrollTop = oldScroll;
}

function hasLearningBranch() {
  const p = currentProblem();
  return (
    p?.judge?.setups?.some((s) => s.replies.length > 1) ||
    p?.nodes?.some((n) =>
      n.choices?.some((c) => c.continuations?.length > 1),
    ) ||
    (p?.kind === "play" && learning?.history?.some((m) => m.side === 2))
  );
}
function openUnit(id, returnToPractice = false, targetProblemId = null) {
  if (!returnToPractice) {
    const u = units.find((u) => u.id === id);
    if (!u?.problemIds.length) return;
    unitId = id;
    lessonTarget = targetProblemId;
    startProblem(targetProblemId || u.problemIds[0], {
      queue: targetProblemId ? [targetProblemId] : u.problemIds,
      role: "lesson",
    });
    return;
  }
  lessonTarget = targetProblemId;
  if (learningRole === "assessment" && learning?.status === "choose") {
    learning = markLearningGuidance(learning);
    saveLearning();
  }
  demoReturn = returnToPractice;
  unitId = id;
  learnScreen = "demo";
  lessonReplay = null;
  demoStep = 0;
  pending.learn = null;
  progress = recordLessonView(progress, id);
  exposeLesson(id);
  save("learning-v2", progress);
  render();
}
function startProblem(id, { queue = null, variant = 0, role = "lesson" } = {}) {
  learningRole = role;
  learning = createAttempt(id, {
    replyVariant: variant,
    attemptId: crypto.randomUUID(),
  });
  if (queue) {
    problemQueue = queue;
    queueIndex = Math.max(0, queue.indexOf(id));
  } else if (!problemQueue.includes(id)) {
    problemQueue = [id];
    queueIndex = 0;
  }
  unitId = currentProblem()?.unitId || unitId;
  learnScreen = "practice";
  lessonReplay = null;
  pending.learn = null;
  saveLearning();
  render();
}
function startUnit() {
  const u = units.find((u) => u.id === unitId);
  if (u?.problemIds.length)
    startProblem(lessonTarget || u.problemIds[0], {
      queue: lessonTarget ? [lessonTarget] : u.problemIds,
    });
}
function submitLearning(i = null, choice = null) {
  if (!learning || lessonReplay) return;
  const before = learning;
  learning =
    choice !== null
      ? answerLearningChoice(learning, choice)
      : playLearningMove(learning, i);
  if (before === learning) return;
  pending.learn = null;
  let transitions = getLearningView(learning).transitionFrames;
  if (transitions.length && learning.status === "solved") {
    lessonReplay = { kind: "transition", frames: transitions, step: 0 };
  }
  if (learning.status !== "choose") markLiveHelp("lesson-feedback");
  saveLearning();
  se.play(
    learning.status === "solved"
      ? "correct"
      : learning.feedback.correct === false
        ? "wrong"
        : learning.feedback.correct === null
          ? "tap"
          : "stone",
  );
  render();
}
function nextLearning() {
  if (learningRole !== "assessment" && queueIndex + 1 < problemQueue.length) {
    queueIndex++;
    startProblem(problemQueue[queueIndex], { role: "lesson" });
  } else goRecommended();
}

function replayLearning(kind) {
  if (kind === "refutation") exposeCurrent("answer");
  if (learning?.status === "choose") {
    exposeCurrent("explanation");
    markLiveHelp("explanation");
    learning = markLearningGuidance(learning);
    saveLearning();
  }
  const v = getLearningView(learning),
    frames = kind === "refutation" ? v.refutationFrames : v.transitionFrames;
  if (frames.length) {
    lessonReplay = { kind, frames, step: 0 };
    pending.learn = null;
    render();
  }
}

function archiveFailure(next) {
  pendingNewAction = next;
  openModal(
    `<h2>棋譜を保存できません</h2><div class='menu-list'>${button("export", "棋譜を書き出す", "primary")}${button("new-without-save", "保存せず始める")}${button("close-modal", "戻る")}</div>`,
  );
}
function newGame() {
  if (archivePending) {
    if (!save("records", records)) {
      archiveFailure(newGame);
      return;
    }
    archivePending = false;
  }
  cpuToken++;
  journeyEpoch++;
  journeyBusy = false;
  if (engine?.pending) engine.cancel();
  cpuBusy = false;
  hintBusy = false;
  cpuError = null;
  hint = null;
  pending.play = null;
  game = {
    id: crypto.randomUUID(),
    moves: [],
    level,
    result: null,
    started: Date.now(),
    assisted: false,
  };
  attachGameEvidence(game);
  playTrace = createJourney("practice", { attemptId: game.id });
  saveGame();
  mode = "play";
  save("view-v2", mode);
  render();
  return true;
}
function requestNew(nextLevel = null) {
  const commit = () => {
    if (nextLevel) {
      level = nextLevel;
      save("level", level);
    }
    closeModal();
    newGame();
  };
  if (!game.moves.length || game.result) {
    commit();
    return;
  }
  openModal(
    `<h2>新しい対局を始める？</h2><p>今の対局は途中の棋譜として残します。</p><div class='modal-actions'>${button("close-modal", "戻る")}${button("confirm-new", "始める", "primary")}</div>`,
  );
  $('#modal-body [data-action="confirm-new"]').onclick = () => {
    if (saveUnfinished() === false) {
      archiveFailure(commit);
      return;
    }
    commit();
  };
}
function saveUnfinished() {
  if (!game.moves.length || game.result) return;
  const saved = { ...structuredClone(game), result: "unfinished" };
  recordGameEvidence();
  const ix = records.findIndex((r) => r.id === game.id);
  if (ix < 0) records.push(saved);
  else records[ix] = saved;
  const ok = save("records", records);
  archivePending = !ok;
  return ok;
}
function finish(result) {
  game.result = result;
  game.finished = Date.now();
  recordGameEvidence();
  const ix = records.findIndex((r) => r.id === game.id);
  if (ix < 0) records.push(structuredClone(game));
  else records[ix] = structuredClone(game);
  archivePending = !save("records", records);
  if (!archivePending) saveGame();
  else save("draft", game);
  se.play(result === "win" ? "win" : "lose");
  render();
  if (mode !== "play")
    toast(result === "win" ? "対局終了：あなたの勝ち" : "対局が終了しました");
}
function putGame(i) {
  const b = boardFrom(game.moves);
  if (b[i] || game.result || !Number.isInteger(i) || i < 0 || i >= 225)
    return false;
  const side = (game.moves.length % 2) + 1;
  if (!game.moves.length) recordGameEvidence();
  game.moves.push({ i });
  if (playTrace) {
    playTrace =
      side === 1
        ? playJourneyMove(playTrace, i)
        : applyJourneyReply(playTrace, i);
  }
  b[i] = side;
  pending.play = null;
  hint = null;
  se.play("stone");
  saveGame();
  if (winningLine(b, i).length) finish(side === 1 ? "win" : "loss");
  else if (game.moves.length === 225) finish("draw");
  render();
  return true;
}
async function cpuTurn() {
  if (
    titleVisible ||
    !engine?.ready ||
    engine.pending ||
    journeyBusy ||
    cpuBusy ||
    hintBusy ||
    game.result ||
    game.moves.length % 2 === 0
  )
    return;
  const token = cpuToken,
    gameId = game.id;
  cpuBusy = true;
  cpuError = null;
  render();
  try {
    const r = await engine.search(game.moves, levels[game.level]);
    if (token !== cpuToken || gameId !== game.id) return;
    cpuBusy = false;
    if (!putGame(r.i)) throw Error("invalid move");
  } catch (e) {
    if (token !== cpuToken) return;
    cpuBusy = false;
    cpuError = true;
    render();
  } finally {
    if (mode === "learn" && learnScreen === "journey") journeyReply();
  }
}
async function getHint() {
  if (!canPlace() || game.exam) return;
  markLiveHelp("hint");
  pending.play = null;
  hintBusy = true;
  const token = cpuToken;
  render();
  try {
    const b = boardFrom(game.moves),
      wins = winningMoves(b, 1),
      danger = winningMoves(b, 2);
    const r = wins.length
      ? { i: wins[0] }
      : danger.length === 1
        ? { i: danger[0] }
        : await engine.search(game.moves, { ms: 1800, strength: 100 });
    if (token !== cpuToken) return;
    const frames = describeMove(b, r.i, 1);
    const f = Array.isArray(frames) ? frames.at(-1) : frames;
    hint = {
      title: `${coord(r.i)}を候補に`,
      text: f?.text || "相手の返しも考えてみよう。",
      highlights: [
        {
          cells:
            f?.highlights?.flatMap((g) => g.cells).filter((i) => b[i]) || [],
          points: [r.i],
          tone: "good",
        },
      ],
    };
  } catch {
    if (token === cpuToken) toast("ヒントを確認できませんでした");
  } finally {
    if (token === cpuToken) {
      hintBusy = false;
      render();
      if (mode === "learn" && learnScreen === "journey") journeyReply();
    }
  }
}
function undo() {
  if (cpuBusy || hintBusy || game.result || !game.moves.length || game.exam)
    return;
  game.moves.splice(
    -Math.min(game.moves.length, game.moves.length % 2 ? 1 : 2),
  );
  game.assisted = true;
  if (playTrace) playTrace = retryJourney(playTrace, game.moves.length);
  hint = null;
  pending.play = null;
  saveGame();
  render();
}
let reviewAutoOpen = true;
function recordKey(r) {
  return (
    r.id +
    ":" +
    r.level +
    ":" +
    r.moves.map((m) => (typeof m === "number" ? m : m.i)).join(",")
  );
}
function loadReview(record, focusPly = null) {
  reviewTargetPly = focusPly;
  markLiveHelp("analysis");
  reviewJob++;
  reviewWorker?.terminate();
  reviewWorker = null;
  closeModal();
  try {
    review = validateRecord({
      ...structuredClone(record),
      rule: "freestyle15",
    });
  } catch {
    toast("棋譜を開けませんでした");
    return;
  }
  mode = "review";
  save("view-v2", mode);
  reviewScreen = "record";
  reviewStep = review.moves.length;
  reviewRetry = null;
  pending.review = null;
  momentIndex = 0;
  reviewFrame = 0;
  reviewPhase = "advice";
  moments = [];
  const cached = reviewCache.get(recordKey(review));
  if (cached && cached.length === review.moves.length) {
    moments = cached.moments;
    storeReviewEvidence(review, moments);
    reviewFrame = 0;
    reviewScan = {
      state: "done",
      done: review.moves.length,
      total: review.moves.length,
      coverage: cached.coverage,
    };
    if (moments.length) {
      reviewScreen = "moment";
      momentIndex = Math.max(
        0,
        moments.findIndex((m) => m.ply === reviewTargetPly),
      );
    }
    render();
  } else {
    render();
    scanReview();
  }
}
function scanReview() {
  if (!review) return;
  reviewWorker?.terminate();
  reviewJob++;
  const id = reviewJob;
  const scanningRecord = structuredClone(review),
    cacheKey = recordKey(scanningRecord);
  reviewAutoOpen = true;
  reviewScan = { state: "running", done: 0, total: review.moves.length };
  render();
  reviewWorker = new Worker(
    new URL("./review-worker.js?v=learning-v3-20261111", import.meta.url),
    {
      type: "module",
    },
  );
  reviewWorker.onmessage = ({ data }) => {
    if (data.id !== reviewJob || !review || recordKey(review) !== cacheKey)
      return;
    if (data.type === "progress") {
      reviewScan = { ...reviewScan, done: data.done, total: data.total };
      if (mode === "review" && !libraryVisible()) render();
    }
    if (data.type === "result") {
      moments = data.moments;
      storeReviewEvidence(scanningRecord, moments);
      reviewScan = {
        state: "done",
        done: reviewScan.total,
        total: reviewScan.total,
        coverage: data.coverage,
      };
      reviewCache.set(cacheKey, {
        length: scanningRecord.moves.length,
        moments,
        coverage: data.coverage,
      });
      if (moments.length && reviewAutoOpen) {
        reviewScreen = "moment";
        momentIndex = Math.max(
          0,
          moments.findIndex((m) => m.ply === reviewTargetPly),
        );
        reviewFrame = 0;
        reviewPhase = "advice";
      }
      reviewWorker.terminate();
      reviewWorker = null;
      if (mode === "review") render();
    }
    if (data.type === "error") {
      reviewScan.state = "error";
      reviewWorker?.terminate();
      reviewWorker = null;
      if (mode === "review") render();
    }
  };
  reviewWorker.onerror = () => {
    if (id === reviewJob) {
      reviewScan.state = "error";
      reviewWorker?.terminate();
      reviewWorker = null;
      if (mode === "review") render();
    }
  };
  reviewWorker.postMessage({ type: "scan", id, record: scanningRecord });
}
function openMoment(n) {
  selectedReviewPattern = null;
  if (!moments.length) return;
  momentIndex = (n + moments.length) % moments.length;
  reviewScreen = "moment";
  reviewRetry = null;
  reviewPhase = "advice";
  reviewFrame = 0;
  pending.review = null;
  render();
}
function startReviewRetry() {
  const m = moments[momentIndex];
  if (!m) return;
  reviewRetry = {
    status: "choose",
    title: "この局面で試す",
    text:
      m.scope === "line-prevented"
        ? "相手の勝ち筋を消す一手を選ぼう。"
        : "勝ちにつながる一手を選ぼう。",
    frame: { board: m.before.slice(), last: null, highlights: [] },
  };
  pending.review = null;
  reviewFrame = 0;
  render();
}
function submitReview(i) {
  if (reviewRetry?.status !== "choose") return;
  const v = judgeReviewMove(moments[momentIndex], i);
  if (v.status === "illegal") return;
  const b = moments[momentIndex].before.slice();
  b[i] = 1;
  reviewRetry = {
    status: "feedback",
    verdictStatus: v.status,
    title: v.title,
    text: v.text,
    accepted: v.accepted,
    move: i,
    frames: v.frames?.length
      ? v.frames
      : [{ board: b, last: i, title: v.title, text: v.text, highlights: [] }],
    frame: null,
  };
  reviewFrame = Math.min(1, reviewRetry.frames.length - 1);
  reviewRetry.frame = reviewRetry.frames[reviewFrame];
  pending.review = null;
  se.play(v.accepted ? "correct" : v.status === "refuted" ? "wrong" : "tap");
  render();
}
function setReviewStep(n) {
  selectedReviewPattern = null;
  reviewAutoOpen = false;
  reviewScreen = "record";
  reviewRetry = null;
  reviewStep = Math.max(
    reviewStartPly(review),
    Math.min(review.moves.length, n),
  );
  render();
}
function reviewFrameStep(delta) {
  selectedReviewPattern = null;
  const frames = reviewFrames();
  reviewFrame = Math.max(0, Math.min(frames.length - 1, reviewFrame + delta));
  if (reviewRetry) reviewRetry.frame = frames[reviewFrame];
  render();
}
function exportRecord() {
  const r = mode === "review" && review ? review : game;
  if (!r.moves.length) return toast("棋譜がありません");
  const url = URL.createObjectURL(
    new Blob(
      [JSON.stringify({ ...r, rule: "freestyle15", version: 1 }, null, 2)],
      { type: "application/json" },
    ),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `楚涵-${new Date().toISOString().slice(0, 10)}-${r.moves.length}手.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function selectCell(i) {
  if (!canPlace()) return;
  const b = getFrame().board;
  if (b[i]) return;
  pending[mode] = i;
  se.play("tap");
  render();
}
function showPrecision() {
  precisionCenter = pending[mode] ?? getFrame().last ?? 112;
  renderPrecision();
}
function renderPrecision() {
  const frame = getFrame(),
    editable = canPlace(),
    x = Math.max(1, Math.min(13, precisionCenter % 15)),
    y = Math.max(1, Math.min(13, Math.floor(precisionCenter / 15)));
  let cells = "";
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const i = (y + dy) * 15 + x + dx,
        c = frame.board[i];
      cells += `<button data-action='precise-pick' data-index='${i}' class='precise-cell ${i === pending[mode] ? "chosen" : ""}' aria-label='${coord(i)} ${c ? stoneName(skin(), c) : "空点"}' ${c || !editable ? "disabled" : ""}>${c ? `<img src='${stoneSprite(skin(), c)}' alt=''>` : `<span class='precision-cross'></span>`}<b>${coord(i)}</b></button>`;
    }
  openModal(
    `<h2>${editable ? "交点を選ぶ" : "周囲を拡大"}</h2><div class='precision-grid'>${cells}</div><div class='precision-pan'>${[-15, -1, 1, 15].map((d, j) => button("precision-pan", ["↑", "←", "→", "↓"][j], "secondary", `data-delta='${d}' aria-label='${["上", "左", "右", "下"][j]}へ'`)).join("")}</div>`,
  );
}
function matchMenu() {
  openModal(
    `<h2>対局</h2><div class='menu-list'>${button("numbers-setting", `手順番号 ${numbers ? "オン" : "オフ"}`)}${button("export", "棋譜を書き出す")}${game.moves.length && !game.result ? button("ask-resign", "投了する") : ""}</div>`,
  );
}
function settings() {
  openModal(
    `<h2>設定</h2><div class='menu-list'>${button("sound-setting", `効果音 ${sound ? "オン" : "オフ"}`)}${button("numbers-setting", `手順番号 ${numbers ? "オン" : "オフ"}`)}${button("import", "棋譜を読み込む")}${button("export-learning", "学習記録を書き出す")}</div><div class='rule-chips'><span>15 × 15</span><span>黒先手</span><span>禁手なし</span><span>五連以上</span></div><details><summary>ルール・クレジット</summary><p>縦・横・斜めに五つ以上並べると勝ち。三三・四四・長連も有効。</p><p><a href='https://github.com/dotb1ue/rapfi' target='_blank' rel='noopener'>Rapfi</a> · <a href='engine/LICENSE.txt' target='_blank'>GPL-3.0</a> · <a href='engine/SOURCE.txt' target='_blank'>出典</a> · <a href='engine/rapfi-source.tar.gz'>ソース</a></p></details>`,
  );
}
function toggleSound() {
  sound = !sound;
  se.enabled = sound;
  save("sound", sound);
  if (sound) se.play("tap");
  render();
}
function retryEngine() {
  cpuError = null;
  cpuToken++;
  cpuBusy = false;
  hintBusy = false;
  engine.cancel();
  render();
}
const actions = {
  "unavailable-check": (el) =>
    showAssessmentUnavailable(
      assessmentAvailability(
        pathProgress,
        el.dataset.unitId,
        assessmentProblems,
        { phase: el.dataset.phase, at: nowISO() },
      ),
    ),
  "unavailable-practice": (el) => {
    closeModal();
    openUnit(el.dataset.unitId, false, el.dataset.problemId || null);
  },
  "unavailable-units": () => {
    closeModal();
    mode = "learn";
    learnScreen = "library";
    learnSection = "lessons";
    render();
  },
  "title-guide": () => dismissTitle("guide"),
  "title-start": () => dismissTitle("play"),
  "title-learn": () => dismissTitle("learn"),
  retry: retryEngine,
  "retry-engine": retryEngine,
  "path-next": () => goRecommended(),
  "assessment-remedial": () => goRecommended(currentProblem()?.unitId),
  "unit-next": (el) => goRecommended(el.dataset.unitId),
  "unit-practical": (el) =>
    startJourney("practice", { white: practiceLevelFor(el.dataset.unitId) }),
  "unit-check": (el) => startAssessment(el.dataset.unitId || unitId),
  "retention-check": (el) =>
    startAssessment(el.dataset.unitId || unitId, "retention"),
  "unit-remedial": (el) => openUnit(el.dataset.unitId),
  "journey-start": (el) => {
    const t = journeyTracks.find((t) => t.id === el.dataset.track);
    if (!t) return;
    if (t.unaided) {
      startJourney(t.id);
      return;
    }
    openModal(
      `<h2>${esc(t.title)}</h2><div class='menu-list'>${(t.id === "branch" ? t.replyVariants : ["natural", "H7", "G7", "H6"]).map((v) => button("journey-variant", t.id === "branch" ? `${["E8", "I8"].includes(v) ? "横" : "縦"}を塞ぐ · 白${v}` : v === "natural" ? "CPUに任せる" : `白${v}から`, "secondary", `data-track='${t.id}' data-variant='${v}'`)).join("")}</div>`,
    );
  },
  "journey-variant": (el) =>
    startJourney(el.dataset.track, { replyVariant: el.dataset.variant }),
  "journey-resume": () => {
    journeyHelpKey = null;
    mode = "learn";
    learnScreen = "journey";
    learnSection = "games";
    lessonReplay = null;
    render();
    journeyReply();
  },
  "journey-hint": () => {
    if (
      !journey ||
      journey.completed ||
      journeyBusy ||
      getJourneyView(journey).turn !== 1
    )
      return;
    journeyHelpKey = `${journey.id}:${journey.moves.length}`;
    journey = markJourneyAssistance(journey, "hint");
    saveJourney();
    render();
  },
  "journey-reply": () => {
    if (engineState === "error") retryEngine();
    else journeyReply();
  },
  "journey-retry": () => {
    if (!journey || journeyBusy || journey.completed) return;
    journey = retryJourney(journey);
    journeyHelpKey = null;
    pending.learn = null;
    saveJourney();
    render();
  },
  "journey-objectives": () => {
    const v = getJourneyView(journey);
    openModal(
      `<h2>${esc(v.title)}</h2><div class='objective-list'>${v.objectives.map((o) => `<p>${o.status === "achieved" ? "✓" : v.completed && o.status === "not-observed" ? "—" : "○"} ${esc(o.title)}${v.completed && o.status === "not-observed" ? "（機会なし）" : ""}</p>`).join("")}</div>`,
    );
  },
  "journey-inspect": () => {
    if (!journey) return;
    if (!journey.completed) journey = markJourneyAssistance(journey, "review");
    archiveJourney();
    const r = practiceGames.find((r) => r.id === journey.id);
    loadReview(r);
  },
  "practice-resume": (el) => resumePractice(el.dataset.practice),
  "practice-review": (el) =>
    loadReview(practiceGames.find((r) => r.id === el.dataset.practice)),
  "review-continue": startRecovery,
  "exam-start": startExam,
  "exam-next": () => {
    if (getExamStatus(pathProgress, { seriesId: examSeries }).attempts >= 10) {
      mode = "learn";
      learnScreen = "library";
      learnSection = "games";
      render();
    } else startExam();
  },
  new: () => requestNew(),
  "new-without-save": () => {
    archivePending = false;
    const next = pendingNewAction;
    pendingNewAction = null;
    closeModal();
    next?.();
  },
  "close-modal": closeModal,
  "go-play": () => switchMode("play"),
  place: () => {
    if (!canPlace() || pending[mode] === null) return;
    const i = pending[mode];
    if (mode === "play") {
      if (putGame(i)) cpuTurn();
    } else if (mode === "learn") {
      if (learnScreen === "journey") putJourney(i);
      else submitLearning(i);
    } else submitReview(i);
  },
  undo,
  hint: getHint,
  precision: showPrecision,
  "match-menu": matchMenu,
  level: (el) => {
    if (el.dataset.level !== (game.moves.length ? game.level : level))
      requestNew(el.dataset.level);
  },
  "ask-resign": () =>
    openModal(
      `<h2>投了する？</h2><div class='modal-actions'>${button("close-modal", "続ける")}${button("resign", "投了する", "primary")}</div>`,
    ),
  resign: () => {
    closeModal();
    cpuToken++;
    if (engine.pending) engine.cancel();
    cpuBusy = false;
    hintBusy = false;
    finish("resign");
  },
  "learn-library": () => {
    learnScreen = "library";
    lessonReplay = null;
    render();
  },
  "learn-lessons": () => {
    learnSection = "lessons";
    learnScreen = "library";
    render();
  },
  "learn-section": (el) => {
    learnSection = el.dataset.section;
    render();
  },
  "learn-resume": () => {
    learnScreen = "practice";
    lessonReplay = null;
    render();
  },
  "mixed-start": () => {
    const ids = problems
      .filter(
        (p) =>
          p.role !== "assessment" &&
          (learnSection === "retry"
            ? needsRetry(p.id)
            : p.unitId !== units[0]?.id),
      )
      .map((p) => p.id);
    if (ids.length) startProblem(ids[0], { queue: ids });
  },
  "demo-prev": () => {
    demoStep = Math.max(0, demoStep - 1);
    exposeLesson(unitId);
    render();
  },
  "demo-next": () => {
    demoStep = Math.min(getDemoFrames(unitId).length - 1, demoStep + 1);
    exposeLesson(unitId);
    render();
  },
  "unit-practice": startUnit,
  "learning-choice": (el) => submitLearning(null, el.dataset.choice),
  "learning-hint": () => {
    exposeCurrent("hint");
    markLiveHelp("hint");
    learning = hintLearning(learning);
    saveLearning();
    render();
  },
  "learning-retry": () => {
    learning = retryLearning(learning);
    lessonReplay = null;
    pending.learn = null;
    saveLearning();
    render();
  },
  "learning-refutation": () => replayLearning("refutation"),
  "learning-transition": () => replayLearning("transition"),
  "lesson-replay-prev": () => {
    lessonReplay.step = Math.max(0, lessonReplay.step - 1);
    render();
  },
  "lesson-replay-next": () => {
    lessonReplay.step = Math.min(
      lessonReplay.frames.length - 1,
      lessonReplay.step + 1,
    );
    render();
  },
  "lesson-replay-close": () => {
    lessonReplay = null;
    render();
  },
  "learning-next": nextLearning,
  "learning-branch": () =>
    startProblem(learning.problemId, {
      variant: learning.replyVariant + 1,
      role: "lesson",
    }),
  "learning-demo": () => {
    exposeCurrent("demo");
    if (learning.status === "choose") {
      learning = markLearningGuidance(learning);
      saveLearning();
    }
    openUnit(currentProblem().unitId, true);
  },
  "demo-return": () => {
    demoReturn = false;
    learnScreen = "practice";
    render();
  },
  "review-current": () => loadReview(game),
  "review-library": () => {
    reviewAutoOpen = false;
    reviewScreen = "library";
    render();
  },
  "scan-review": scanReview,
  "cancel-scan": () => {
    reviewJob++;
    reviewWorker?.terminate();
    reviewWorker = null;
    reviewScan.state = "cancelled";
    render();
  },
  "show-moments": () => openMoment(0),
  "next-moment": () => openMoment(momentIndex + 1),
  "review-actual": () => {
    selectedReviewPattern = null;
    reviewPhase = "actual";
    reviewFrame = 1;
    render();
  },
  "review-advice": () => {
    reviewPhase = "advice";
    reviewFrame = 0;
    selectedReviewPattern = null;
    render();
  },
  "review-this-moment": () =>
    openMoment(moments.findIndex((m) => m.ply === reviewStep)),
  "review-patterns": () => {
    const f = getFrame();
    openModal(
      `<h2>この局面の型</h2><div class='menu-list'>${(f.motifs || []).map((p) => button("select-review-pattern", esc(present((p.color === 1 ? "黒" : "白") + "の" + p.name)), "secondary", `data-pattern='${esc(p.id)}'`)).join("")}</div><p class='lesson-copy'>${esc(present(f.selectedMotif?.lesson))}</p>${button("review-related", "この型を学ぶ", "primary")}`,
    );
  },
  "select-review-pattern": (el) => {
    selectedReviewPattern = el.dataset.pattern;
    closeModal();
    render();
  },
  "review-better": () => {
    selectedReviewPattern = null;
    reviewPhase = "better";
    reviewFrame = 0;
    render();
  },
  "review-frame-prev": () => reviewFrameStep(-1),
  "review-frame-next": () => reviewFrameStep(1),
  "review-record": () =>
    setReviewStep(moments[momentIndex]?.ply || review.moves.length),
  "review-first": () => setReviewStep(0),
  "review-prev": () => setReviewStep(reviewStep - 1),
  "review-next": () => setReviewStep(reviewStep + 1),
  "review-last": () => setReviewStep(review.moves.length),
  "review-retry": startReviewRetry,
  "review-cancel-retry": () => {
    reviewRetry = null;
    reviewFrame = 0;
    render();
  },
  "review-related": () => {
    const skill =
        getFrame().selectedMotif?.skillId || moments[momentIndex]?.skillId,
      target =
        {
          shape: "conditions",
          connections: "opening",
          preparation: "prepare",
          real: "practice",
        }[skill] || skill;
    closeModal();
    mode = "learn";
    save("view-v2", mode);
    learnSection = "lessons";
    openUnit(units.find((u) => u.id === target)?.id || units[0].id);
  },
  "precise-pick": (el) => {
    const i = Number(el.dataset.index);
    if (canPlace() && !getFrame().board[i]) {
      closeModal();
      selectCell(i);
    }
  },
  "precision-pan": (el) => {
    const d = Number(el.dataset.delta);
    let x = precisionCenter % 15,
      y = Math.floor(precisionCenter / 15);
    if (Math.abs(d) === 15) y = Math.max(1, Math.min(13, y + d / 15));
    else x = Math.max(1, Math.min(13, x + d));
    precisionCenter = y * 15 + x;
    renderPrecision();
  },
  "sound-setting": () => {
    toggleSound();
    settings();
  },
  "numbers-setting": () => {
    numbers = !numbers;
    save("numbers", numbers);
    closeModal();
    render();
  },
  "export-learning": () => {
    const data = {
      version: 3,
      rule: "freestyle15",
      exportedAt: nowISO(),
      path: pathProgress,
      practiceGames,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `楚涵-学習記録-${nowISO().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  import: () => {
    closeModal();
    $("#import-file").click();
  },
  export: exportRecord,
};
document.addEventListener("click", (e) => {
  const el = e.target.closest("button");
  if (!el || el.disabled) return;
  if (el.dataset.cell !== undefined) {
    selectCell(Number(el.dataset.cell));
    return;
  }
  if (el.dataset.mode) {
    se.play("tap");
    switchMode(el.dataset.mode);
    return;
  }
  if (el.dataset.unit) {
    openUnit(el.dataset.unit);
    return;
  }
  if (el.dataset.problem) {
    startProblem(el.dataset.problem, { queue: [el.dataset.problem] });
    return;
  }
  if (el.dataset.record !== undefined) {
    loadReview(records[Number(el.dataset.record)]);
    return;
  }
  if (el.dataset.action) {
    if (el.dataset.action !== "place") se.play("tap");
    actions[el.dataset.action]?.(el);
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "review-slider") setReviewStep(Number(e.target.value));
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
  const i = Number(el.dataset.cell);
  let n = i;
  if (e.key === "ArrowLeft" && i % 15) n = i - 1;
  if (e.key === "ArrowRight" && i % 15 < 14) n = i + 1;
  if (e.key === "ArrowUp" && i >= 15) n = i - 15;
  if (e.key === "ArrowDown" && i < 210) n = i + 15;
  if (n !== i) {
    e.preventDefault();
    el.tabIndex = -1;
    const next = $(`[data-cell='${n}']`);
    next.tabIndex = 0;
    next.focus();
  }
});
$("#sound").onclick = toggleSound;
$("#about").onclick = settings;
$(".modal-close").onclick = closeModal;
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
    records.push(r);
    save("records", records);
    loadReview(r);
  } catch {
    toast("棋譜を読み込めませんでした");
  }
};
initBoard();
syncViewport();
window.addEventListener("resize", syncViewport);
window.visualViewport?.addEventListener("resize", syncViewport);
render();
engine = new Engine(
  (state) => {
    engineState = state;
    updateLoading(state);
    render();
    if (state === "ready" && !titleVisible) {
      if (mode === "play") cpuTurn();
      if (mode === "learn" && learnScreen === "journey") journeyReply();
    }
  },
  () => {},
  (p) => updateLoading("progress", p),
);
