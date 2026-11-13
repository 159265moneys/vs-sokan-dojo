import {
  exerciseSatisfied,
  exerciseMoves,
  exerciseFacts,
} from "./learning-objectives.js";
import {
  units,
  problems,
  curriculumVersion,
} from "./curriculum.js?v=curriculum-v5-stage3-20261113";
import { coord } from "./game.js";
import { tacticalHintStages } from "./learning-hints.js";
import { positionFingerprint } from "./learning-path.js?v=curriculum-v5-stage3-20261113";

const clone = (x) => JSON.parse(JSON.stringify(x));
const byId = new Map(problems.map((p) => [p.id, p]));
const byUnit = new Map(units.map((u) => [u.id, u]));
const validPoint = (i) => Number.isInteger(i) && i >= 0 && i < 225;
const validBoard = (b) =>
  Array.isArray(b) &&
  b.length === 225 &&
  b.every((c) => c === 0 || c === 1 || c === 2);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const at = (x, y) => y * 15 + x;
const directions = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];
const windows = [];
const sixWindows = [];
for (let y = 0; y < 15; y++)
  for (let x = 0; x < 15; x++)
    for (const [dx, dy] of directions) {
      const endX = x + 4 * dx,
        endY = y + 4 * dy;
      if (endX >= 0 && endX < 15 && endY >= 0 && endY < 15)
        windows.push(
          Array.from({ length: 5 }, (_, k) => at(x + k * dx, y + k * dy)),
        );
      const outerX = x + 5 * dx,
        outerY = y + 5 * dy;
      if (outerX >= 0 && outerX < 15 && outerY >= 0 && outerY < 15)
        sixWindows.push(
          Array.from({ length: 6 }, (_, k) => at(x + k * dx, y + k * dy)),
        );
    }
function winningCells(board, side) {
  return windows.find((w) => w.every((i) => board[i] === side)) || [];
}
function winner(board) {
  return winningCells(board, 1).length
    ? 1
    : winningCells(board, 2).length
      ? 2
      : 0;
}
function winPoints(board, side) {
  const out = new Set();
  for (const w of windows) {
    let own = 0,
      empty = -1,
      blocked = false;
    for (const i of w) {
      if (board[i] === side) own++;
      else if (board[i] === 0) empty = i;
      else {
        blocked = true;
        break;
      }
    }
    if (!blocked && own === 4 && empty >= 0) out.add(empty);
  }
  return [...out].sort((a, b) => a - b);
}
function fourCandidates(board, side) {
  const out = new Set();
  for (const w of windows) {
    let own = 0,
      blocked = false;
    const gaps = [];
    for (const i of w) {
      if (board[i] === side) own++;
      else if (!board[i]) gaps.push(i);
      else {
        blocked = true;
        break;
      }
    }
    if (!blocked && own === 3) gaps.forEach((i) => out.add(i));
  }
  return [...out].sort((a, b) => a - b);
}
function forkMoves(board, side) {
  return fourCandidates(board, side).filter((i) => {
    const b = [...board];
    b[i] = side;
    return winPoints(b, side).length >= 2 && !winPoints(b, 3 - side).length;
  });
}
function solveVCF(input, side, maxPly = 9, maxNodes = 1600) {
  const board = [...input];
  let nodes = 0,
    aborted = false;
  function visit(left) {
    if (++nodes > maxNodes) {
      aborted = true;
      return null;
    }
    const immediate = winPoints(board, side);
    if (immediate.length) return [immediate[0]];
    if (left < 3) return null;
    const enemy = winPoints(board, 3 - side);
    if (enemy.length > 1) return null;
    const candidates = enemy.length ? enemy : fourCandidates(board, side);
    for (const i of candidates) {
      board[i] = side;
      const threats = winPoints(board, side);
      if (!threats.length || winPoints(board, 3 - side).length) {
        board[i] = 0;
        continue;
      }
      if (threats.length >= 2) {
        board[i] = 0;
        return [i, threats[0], threats[1]];
      }
      const reply = threats[0];
      board[reply] = 3 - side;
      const next = visit(left - 2);
      board[reply] = 0;
      board[i] = 0;
      if (next) return [i, reply, ...next];
      if (aborted) return null;
    }
    return null;
  }
  if (winner(board))
    return {
      proven: false,
      line: [],
      nodes: 0,
      terminal: true,
      aborted: false,
    };
  for (let depth = 1; depth <= maxPly; depth += 2) {
    const line = visit(depth);
    if (line) return { proven: true, line, nodes, aborted: false };
    if (aborted) break;
  }
  return { proven: false, line: [], nodes, aborted };
}
function problem(state) {
  const p = byId.get(state.problemId);
  if (!p) throw Error(`問題がありません: ${state.problemId}`);
  return p;
}
function decision(state) {
  return problem(state).nodes.find((n) => n.id === state.nodeId) || null;
}
function highlight(cells = [], points = [], tone = "focus") {
  return { cells: [...cells], points: [...points], tone };
}
function factHighlights(board, last = null) {
  const out = [];
  for (const side of [1, 2]) {
    const points = winPoints(board, side),
      won = winningCells(board, side);
    if (won.length)
      out.push(highlight(won, [], side === 1 ? "good" : "danger"));
    else if (points.length) {
      const cells = [
        ...new Set(
          windows
            .filter(
              (w) =>
                points.some((i) => w.includes(i)) &&
                w.filter((i) => board[i] === side).length === 4,
            )
            .flat()
            .filter((i) => board[i] === side),
        ),
      ];
      out.push(highlight(cells, points, side === 1 ? "good" : "danger"));
    }
  }
  if (!out.length && last !== null && board[last]) out.push(highlight([last]));
  return out;
}
function makeFrame(board, last, title, text = "", highlights = null) {
  if (!text) {
    const black = winPoints(board, 1),
      white = winPoints(board, 2),
      won = winner(board);
    if (won)
      text = `${won === 1 ? "黒" : "白"}の五連以上が完成した。この手で勝負が終わる。`;
    else if (black.length && white.length)
      text = `黒も白も五連にできる点がある。次の${last !== null && board[last] === 1 ? "白" : "黒"}の手番で、先に五連を完成させられる。`;
    else if (black.length >= 2)
      text = `${black.map(coord).join("・")}が黒の勝ち口。白が一つを塞いでも、別の点で黒が五連にできる。`;
    else if (black.length)
      text = `黒は${coord(black[0])}で五連にできる。この勝ち口を使える手番か確認する。`;
    else if (white.length)
      text = `白は${white.map(coord).join("・")}で五連にできる。黒はこの攻めを先に確かめる必要がある。`;
    else
      text =
        "今すぐ五連になる点はない。置かれた石を含めて、次につながる方向を見直す。";
  }
  return {
    board: [...board],
    last,
    title,
    text,
    highlights: highlights || factHighlights(board, last),
  };
}
function replayFrames(board, moves, firstSide = 1) {
  const b = [...board],
    frames = [];
  moves.forEach((m, n) => {
    const i = typeof m === "number" ? m : m.i;
    const side =
      typeof m === "number" ? (n % 2 ? 3 - firstSide : firstSide) : m.side;
    if (!validPoint(i) || b[i] || winner(b)) throw Error("反証手順が不正です");
    b[i] = side;
    const won = winner(b),
      threats = winPoints(b, side);
    const title = won
      ? side === 1
        ? "黒の五連"
        : "白の五連"
      : threats.length >= 2
        ? "二つの勝ち口"
        : threats.length
          ? side === 1
            ? "黒の四"
            : "白の四"
          : side === 1
            ? "ここを受ける"
            : "白の応手";
    frames.push(makeFrame(b, i, title));
  });
  return frames;
}
function emptyFeedback() {
  return {
    kind: "none",
    correct: null,
    claim: "none",
    move: null,
    choiceId: null,
    title: "",
    text: "",
  };
}
function checkpoint(state) {
  return {
    board: [...state.board],
    history: clone(state.history),
    nodeId: state.nodeId,
  };
}
function hintKey(state) {
  return `${state.nodeId || "play"}:${state.history.length}`;
}
function makeHints(board, guide) {
  return tacticalHintStages(board, guide);
}
function guideAfter(state) {
  const own = winPoints(state.board, 1);
  if (own.length) return own;
  const proof = solveVCF(state.board, 1, 9, 1600);
  return proof.proven ? [proof.line[0]] : [];
}
function meetsExercise(board, exercise, placed) {
  return exerciseSatisfied(board, exercise, placed);
}
function exerciseCandidates(board, exercise) {
  return exerciseMoves(board, exercise);
}
function directionName(cells) {
  return cells.every((i) => i % 15 === cells[0] % 15)
    ? "縦"
    : cells.every((i) => ((i / 15) | 0) === ((cells[0] / 15) | 0))
      ? "横"
      : "斜め";
}
function initializeHints(state, guide) {
  state.guide = [...guide];
  state.hintStages =
    !state.exercise && !state.history.length && problem(state).hintStages
      ? clone(problem(state).hintStages)
      : makeHints(state.board, guide);
  state.hintTexts = state.exercise
    ? state.exercise.objective === "two-directions"
      ? [
          "指定の黒石と候補を、縦・横・斜めで結ぶ。",
          "白が途中に入らず、五つ並べる余地がある線を探す。",
          "異なる二つの方向につながる点を比べる。",
        ]
      : state.exercise.objective === "open-four"
        ? [
            "指定した石を使って四を作る候補を探す。",
            "置いた後に、別々の完成点が二つ残るか数える。",
            "外側の白石と盤端まで確かめる。",
          ]
        : state.exercise.objective === "five"
          ? [
              "今の一手で五つつながる点を探す。",
              "端だけでなく、石の間の空点も見る。",
              "自分の五連を完成させる。",
            ]
          : state.exercise.objective === "open-three" &&
              problem(state).questionHighlights
            ? [
                "指定した石を使う三を探す。",
                "その三から四へ伸ばした後、両端が空くか見る。",
                "外側の白石と盤端まで確かめる。",
              ]
            : state.exercise.objective === "safe-four"
              ? [
                  "黒の四を作る候補を探す。",
                  "白が受ける地点から、白の四方向を確かめる。",
                  "白の受けが四を作らない候補を選ぶ。",
                ]
              : state.exercise.objective === "prevent-fork"
                ? [
                    "白が次に二つの完成点を作る交点を探す。",
                    "交点か、その先の完成点を塞ぐ候補を比べる。",
                    "置いた後に白の五連と二つの完成点が残らないか確かめる。",
                  ]
                : [
                    "白が止めた方向を確認する。",
                    "まだ白石のない、残った方向を使う。",
                    state.exercise.title,
                  ]
    : state.history.length
      ? [
          "直前の白石が、どの方向を止めたか見る。",
          winPoints(state.board, 1).length
            ? "もう一方の五連になる点を探す。"
            : "白の受け石を避けて、次の四につながる石を探す。",
          "印の空点から、相手の応手を見て続ける。",
        ]
      : [...problem(state).hintTexts];
  // Exposure history stays cumulative, but entering/retrying/restoring a
  // decision never reopens a hint without the learner asking for it.
  state.hints.level = 0;
}
export function createAttempt(
  problemId,
  { replyVariant = 0, attemptId = null } = {},
) {
  const p = byId.get(problemId);
  if (!p) throw Error(`問題がありません: ${problemId}`);
  const state = {
    schemaVersion: 1,
    curriculumVersion,
    attemptId: typeof attemptId === "string" ? attemptId : null,
    problemId,
    replyVariant:
      Number.isInteger(replyVariant) && replyVariant >= 0 ? replyVariant : 0,
    nodeId: p.rootNodeId,
    board: [...p.board],
    history: [],
    status: "choose",
    checkpoint: { board: [...p.board], history: [], nodeId: p.rootNodeId },
    feedback: emptyFeedback(),
    transitionFrames: [],
    refutationFrames: [],
    hints: { level: 0, maxLevel: 0, uses: 0, byDecision: {} },
    metrics: {
      submittedDecisions: 0,
      acceptedDecisions: 0,
      verifiedMistakes: 0,
      unknownSelections: 0,
      retries: 0,
    },
    guide: [],
    hintStages: [],
    exercise: null,
    guidanceSeen: false,
  };
  initializeHints(state, p.guide || []);
  return state;
}
function submitted(state, i = null, choiceId = null) {
  const next = clone(state);
  next.checkpoint = checkpoint(state);
  next.feedback = { ...emptyFeedback(), move: i, choiceId };
  next.refutationFrames = [];
  next.transitionFrames = [];
  next.metrics.submittedDecisions++;
  if (i !== null) {
    next.board[i] = 1;
    next.history.push({ i, side: 1 });
  }
  return next;
}
function failed(next, kind, title, text, frames = []) {
  if (!text && kind === "proven-loss") {
    const prior = winPoints(next.checkpoint.board, 1),
      reply = frames.find((f) => f.last !== null && f.board[f.last] === 2);
    text =
      (prior.length
        ? `${prior.map(coord).join("・")}なら先に五連を作れた。`
        : "") +
      (reply
        ? winner(reply.board) === 2
          ? `この手には白${coord(reply.last)}で五連が完成する。`
          : `この手には白${coord(reply.last)}から攻めが続く。${reply.text}`
        : "相手の勝ち筋が残る。");
  }
  next.status = "feedback";
  next.feedback = {
    ...next.feedback,
    kind,
    correct: kind === "unknown" || kind === "observation" ? null : false,
    claim: kind === "proven-loss" ? "loss" : "none",
    title,
    text,
  };
  if (kind === "unknown" || kind === "observation")
    next.metrics.unknownSelections++;
  else next.metrics.verifiedMistakes++;
  next.refutationFrames = clone(frames);
  return next;
}
function completed(next, claim, title, text = "") {
  next.status = "solved";
  next.metrics.acceptedDecisions++;
  next.feedback = {
    ...next.feedback,
    kind: "completed",
    correct: true,
    claim,
    title,
    text,
  };
  return next;
}
function afterReply(next, reply, title = "応手を見て続ける") {
  const previousBlackWins = winPoints(next.board, 1);
  const blackFrame = makeFrame(next.board, next.history.at(-1).i, "黒の一手");
  if (!validPoint(reply) || next.board[reply])
    throw Error("教材応手が不正です");
  next.board[reply] = 2;
  next.history.push({ i: reply, side: 2 });
  if (winner(next.board)) throw Error("正解の応手で白が勝っています");
  const guide = guideAfter(next),
    remainingBlackWins = winPoints(next.board, 1),
    remainingWhiteWins = winPoints(next.board, 2);
  const groups = windows
    .filter(
      (w) =>
        guide.some((i) => w.includes(i)) &&
        w.filter((i) => next.board[i] === 1).length >= 3 &&
        !w.some((i) => next.board[i] === 2),
    )
    .map((w) => w.filter((i) => next.board[i] === 1));
  const support = [...new Set(groups.flat())];
  const orientations = [
    ...new Set(
      groups.map((g) =>
        g.every((i) => i % 15 === g[0] % 15)
          ? "縦"
          : g.every((i) => ((i / 15) | 0) === ((g[0] / 15) | 0))
            ? "横"
            : "斜め",
      ),
    ),
  ];
  let replyText = previousBlackWins.includes(reply)
    ? `白は${coord(reply)}を塞ぎ、黒の五連を防いだ。`
    : `白は${coord(reply)}に置いた。`;
  if (remainingBlackWins.length)
    replyText += `黒には${remainingBlackWins.map(coord).join("・")}の勝ち口が残る。片方しか塞げないため、そこで五連にできる。`;
  else if (remainingWhiteWins.length)
    replyText += `同時に白の四ができたので、次はその勝ち口を先に見る。`;
  else if (orientations.length)
    replyText += `${orientations.join("・")}の黒石のつながりは残っている。そこから攻めを続ける。`;
  else
    replyText +=
      "黒の勝ち口は一度消えた。受けた白石を含めて次の攻めを読み直す。";
  const replyHighlights =
    remainingBlackWins.length || remainingWhiteWins.length
      ? factHighlights(next.board, reply)
      : [
          highlight([reply], [], "danger"),
          ...(support.length ? [highlight(support)] : []),
        ];
  next.transitionFrames = [
    blackFrame,
    makeFrame(
      next.board,
      reply,
      previousBlackWins.includes(reply)
        ? `白は${coord(reply)}を守る`
        : "白の応手",
      replyText,
      replyHighlights,
    ),
  ];
  next.status = "choose";
  next.nodeId = `play-${next.history.length}`;
  next.metrics.acceptedDecisions++;
  next.feedback = {
    ...next.feedback,
    kind: "continued",
    correct: true,
    claim: "none",
    title,
    text: "",
  };
  next.checkpoint = checkpoint(next);
  initializeHints(next, guide);
  return next;
}
function whiteRefutation(next, maxPly = 9, maxNodes = 1600) {
  const proof = solveVCF(next.board, 2, maxPly, maxNodes);
  if (!proof.proven) return null;
  const first = makeFrame(
    next.board,
    next.history.at(-1)?.i ?? null,
    "選んだ手",
  );
  return [first, ...replayFrames(next.board, proof.line, 2)];
}
export function playLearningMove(state, i) {
  if (
    state.status !== "choose" ||
    !validPoint(i) ||
    state.board[i] ||
    (decision(state)?.input === "choice" && !state.exercise)
  )
    return state;
  const p = problem(state),
    next = submitted(state, i);
  if (winner(next.board) === 1) {
    const predicted =
      p.questionHighlights &&
      p.nodes.flatMap((n) => n.choices).find((c) => c.correct);
    next.transitionFrames = [
      ...clone(predicted?.frames || []),
      makeFrame(next.board, i, "黒の五連"),
    ];
    return completed(next, "win", "五連");
  }
  if (state.exercise) {
    if (
      p.questionHighlights &&
      ["open-four", "two-directions", "open-three", "five"].includes(
        state.exercise.objective,
      )
    ) {
      const goal = state.exercise.objective;
      const facts = exerciseFacts(next.board, state.exercise, i);
      if (facts) {
        const names = facts.axes.map(
          (axis) => ["横", "縦", "右下がりの斜め", "右上がりの斜め"][axis],
        );
        const title =
          goal === "two-directions"
            ? "二方向につながった"
            : goal === "open-three"
              ? "活四に進める三"
              : "完成点を二つ作った";
        const text =
          goal === "two-directions"
            ? `${coord(i)}から${state.exercise.cells.map(coord).join("・")}へ、${names.join("と")}の白を挟まない線でつながる。それぞれに五つ並べる余地がある。`
            : goal === "open-three"
              ? `${facts.cells.map(coord).join("・")}が、両端の空いた四へ伸ばせる三になった。`
              : `${facts.points.map(coord).join("・")}が別々の完成点になった。白に今すぐ五連を作る点はない。`;
        const predicted = p.nodes
          .flatMap((n) => n.choices)
          .find((c) => c.correct);
        next.transitionFrames = [
          ...clone(predicted?.frames || []),
          makeFrame(next.board, i, title, text, [
            highlight(
              facts.cells,
              facts.points,
              goal === "two-directions" ? "focus" : "good",
            ),
          ]),
        ];
        return completed(next, "local-goal", title, text);
      }
      const enemy = winPoints(next.board, 2);
      const proof = whiteRefutation(next);
      if (proof)
        return failed(next, "proven-loss", "白の攻めが先に届く", "", proof);
      let title = "指定した形を比べる",
        text;
      if (enemy.length)
        text = `白には${enemy.map(coord).join("・")}の完成点が残る。`;
      else if (goal === "two-directions") {
        const missing = state.exercise.cells.filter(
          (cell) =>
            !windows.some(
              (w) =>
                w.includes(i) &&
                w.includes(cell) &&
                w.every((point) => next.board[point] !== 2),
            ),
        );
        title = "二方向の余地を確かめる";
        text = missing.length
          ? `${coord(i)}と${missing.map(coord).join("・")}をつなぐ線には、白を挟まず五つ並べる余地がない。`
          : `${coord(i)}から指定の石への線が、異なる二方向には分かれない。縦・横・斜めの交点を比べよう。`;
      } else if (goal === "open-four") {
        text = `${coord(i)}では、指定の石を使う別々の完成点を二つ作れない。四にした後の外側まで確かめよう。`;
      } else if (goal === "five")
        text = `${coord(i)}では五連にならない。間の空点も含め、今の完成点を探そう。`;
      else
        text = `${coord(i)}では、指定の石を使って活四へ進める三にならない。三の外側の空きを比べよう。`;
      return failed(next, "goal-miss", title, text, [
        makeFrame(next.board, i, title, text, [
          highlight(state.exercise.cells),
        ]),
      ]);
    }
    if (["safe-four", "prevent-fork"].includes(state.exercise.objective)) {
      const safe = state.exercise.objective === "safe-four";
      if (meetsExercise(next.board, state.exercise, i)) {
        const finishes = winPoints(next.board, 1);
        const text = safe
          ? finishes.length >= 2
            ? `${coord(i)}で${finishes.map(coord).join("・")}が黒の完成点。白自身の即勝ちはない。`
            : `${coord(i)}で黒の完成点は${coord(finishes[0])}。白がそこを塞いでも、白の完成点はできない。`
          : `${coord(i)}で、白の即五と次に二つの完成点を作る手を消した。勝負は続く。`;
        const predicted = p.nodes
          .flatMap((n) => n.choices)
          .find((c) => c.correct);
        next.transitionFrames = [
          ...clone(predicted?.frames || []),
          makeFrame(next.board, i, "元の盤で選んだ一手", text),
        ];
        return completed(
          next,
          "local-goal",
          safe ? "受け四を与えない一手" : "次の二重攻撃を防いだ",
          text,
        );
      }
      const finishes = winPoints(next.board, 1);
      let title = "四を作る候補を比べる";
      let text = `${coord(i)}では黒の四ができない。四を作った後、白の受けで何ができるかまで比べよう。`;
      let frames = [makeFrame(next.board, i, title, text)];
      if (safe && finishes.length === 1) {
        const reply = [...next.board];
        reply[finishes[0]] = 2;
        const counter = winPoints(reply, 2);
        if (counter.length) {
          title = "白の受けが四になる";
          text = `白${coord(finishes[0])}で受けると、${counter.map(coord).join("・")}が白の完成点になる。`;
          frames.push(makeFrame(reply, finishes[0], title, text));
        }
      }
      const proof = whiteRefutation(next);
      if (proof)
        return failed(next, "proven-loss", "白の攻めが先に届く", "", proof);
      if (!safe) {
        title = "白の狙いが残る";
        text =
          "この手では、白の五連か次の二重攻撃が残る。交点と外側の空点を比べよう。";
      }
      return failed(next, "goal-miss", title, text, frames);
    }
    if (meetsExercise(next.board, state.exercise, i)) {
      const cells = [...state.exercise.cells, i].sort((a, b) => a - b);
      const shapeText =
        state.exercise.objective === "four"
          ? `次に${winPoints(next.board, 1).map(coord).join("・")}で五連にできる四を作った。`
          : "両端の空いた四につながる三を作った。";
      next.transitionFrames = [
        makeFrame(
          next.board,
          i,
          state.exercise.title,
          `${cells.map(coord).join("・")}を使い、${shapeText}`,
          [highlight(cells, [], "good")],
        ),
      ];
      return completed(next, "comparison", "狙いをつなげた");
    }
    const shapeText =
      state.exercise.objective === "four" ? "四" : "両端四につながる三";
    const frames = [
      makeFrame(
        next.board,
        i,
        "候補を比べる",
        `${coord(i)}では、${state.exercise.cells.map(coord).join("・")}を使う${shapeText}にならない。残った${directionName(state.exercise.cells)}の線で、空き方を比べる。`,
        [highlight(state.exercise.cells)],
      ),
    ];
    return failed(
      next,
      "goal-miss",
      "残った方向を使う",
      state.exercise.title,
      frames,
    );
  }
  const initial = state.history.length === 0;
  if (
    initial &&
    p.judge.firstObjective === "forcing-four" &&
    winPoints(next.board, 1).length === 0
  ) {
    const text =
      "この一手では次の五を脅かせない。四を作り、相手の受けで残る形を比べよう。";
    return failed(next, "goal-miss", "四を続ける手順を試す", text, [
      makeFrame(next.board, i, "この一手は四にならない", text),
    ]);
  }
  if (p.judge.kind === "prevent-fork") {
    const immediate = winPoints(next.board, 2),
      forks = forkMoves(next.board, 2);
    if (!immediate.length && !forks.length) {
      next.transitionFrames = [
        makeFrame(
          next.board,
          i,
          p.judge.successTitle || "次の二重攻撃を消した",
          p.judge.successText || "",
          [highlight([i], [], "good")],
        ),
      ];
      return completed(
        next,
        "local-goal",
        p.judge.successTitle || "次の二重攻撃を防いだ",
        p.judge.successText || "",
      );
    }
    const frames = whiteRefutation(next, 5, 600) || [
      makeFrame(next.board, i, "白の狙いが残る", "", [
        highlight([], [...immediate, ...forks], "danger"),
      ]),
    ];
    return failed(
      next,
      frames.some((f) => winner(f.board) === 2) ? "proven-loss" : "goal-miss",
      "白の勝ち口が残る",
      "",
      frames,
    );
  }
  if (
    p.judge.kind === "open-four-first" &&
    initial &&
    (winPoints(next.board, 1).length < 2 || winPoints(next.board, 2).length)
  ) {
    const own = winPoints(next.board, 1),
      frames = [
        makeFrame(
          next.board,
          i,
          p.judge.failureTitle || "両端が残らない",
          p.judge.failureText || "",
        ),
      ];
    if (own.length === 1 && !next.board[own[0]])
      frames.push(...replayFrames(next.board, [own[0]], 2));
    return failed(
      next,
      "goal-miss",
      p.judge.failureTitle || "両端を残す側へ",
      p.judge.failureText || "外側の白まで見る。",
      frames,
    );
  }
  const own = winPoints(next.board, 1),
    enemy = winPoints(next.board, 2);
  if (enemy.length)
    return failed(next, "proven-loss", "白の五連が先", "", [
      makeFrame(next.board, i, "選んだ手"),
      ...replayFrames(next.board, [enemy[0]], 2),
    ]);
  if (own.length >= 2)
    return afterReply(next, own[state.replyVariant % own.length]);
  const knownSetup = initial ? p.judge.setups?.find((s) => s.move === i) : null;
  if (own.length === 1) {
    const b = [...next.board];
    b[own[0]] = 2;
    const proof = solveVCF(b, 1, p.judge.maxPly || 9, p.judge.maxNodes || 1600);
    if (proof.proven) return afterReply(next, own[0]);
  } else if (knownSetup) {
    const replies = knownSetup.replies.filter((r) => !next.board[r]);
    const reply = replies[state.replyVariant % replies.length];
    const b = [...next.board];
    b[reply] = 2;
    const proof = solveVCF(b, 1, p.judge.maxPly || 9, p.judge.maxNodes || 1600);
    if (!proof.proven)
      throw Error(
        `検証済み準備手の継続がありません: ${p.id}/${coord(i)}/${coord(reply)}`,
      );
    return afterReply(next, reply, "白の着点から続きを読もう");
  }
  const lossFrames = whiteRefutation(
    next,
    Math.min(p.judge.maxPly || 9, 9),
    p.judge.maxNodes || 1600,
  );
  if (lossFrames)
    return failed(next, "proven-loss", "白の攻めが先になる", "", lossFrames);
  const observation = initial
    ? p.judge.observations?.find((o) => o.move === i)
    : null;
  if (observation)
    return failed(
      next,
      "observation",
      observation.title || "つなぎ目を取られる",
      observation.text,
      observation.frames,
    );
  return failed(next, "unknown", "別の攻めを比べる", "この手の先は未確認。", [
    makeFrame(next.board, i, "選んだ手"),
  ]);
}
export function answerLearningChoice(state, choiceId) {
  const n = decision(state);
  if (state.status !== "choose" || state.exercise || n?.input !== "choice")
    return state;
  const c = n.choices.find((c) => c.id === choiceId);
  if (!c) return state;
  const next = submitted(state, null, choiceId);
  if (!c.correct)
    return failed(next, "goal-miss", c.resultTitle, c.text, c.frames);
  if (c.continuations?.length) {
    const continuation =
      c.continuations[state.replyVariant % c.continuations.length];
    next.transitionFrames =
      !continuation.moves.length && problem(state).role !== "assessment"
        ? clone(c.frames)
        : [];
    for (const m of continuation.moves) {
      if (next.board[m.i] || winner(next.board))
        throw Error("比較の手順が不正です");
      const before = [...next.board];
      next.board[m.i] = m.side;
      next.history.push({ ...m });
      const authoredFrame = c.frames.find(
        (f) => f.last === m.i && same(f.board, next.board),
      );
      if (authoredFrame) {
        next.transitionFrames.push(clone(authoredFrame));
        continue;
      }
      if (m.side === 1) {
        const authored = c.frames.find(
          (f) => f.last === m.i && same(f.board, next.board),
        );
        next.transitionFrames.push(
          authored
            ? clone(authored)
            : makeFrame(
                next.board,
                m.i,
                "選んだ組み立て",
                `${continuation.cells.map(coord).join("・")}を使う組み立てを選んだ。白の応手で、次に残る方向を比べる。`,
              ),
        );
      } else {
        const blocked = windows
          .filter((w) => w.includes(m.i) && w.every((i) => before[i] !== 2))
          .map((w) => w.filter((i) => before[i] === 1))
          .filter((g) => g.length >= 2)
          .sort((a, b) => b.length - a.length)[0];
        const stopped = blocked
          ? `${directionName(blocked)}の続きを止めた`
          : "一方の広がりを止めた";
        const remaining =
          continuation.objective === "four"
            ? `${continuation.cells.map(coord).join("・")}を使い、残った側に四を作る。`
            : `${directionName(continuation.cells)}の${continuation.cells.map(coord).join("・")}は残っているので、その二石から三を作る。`;
        next.transitionFrames.push(
          makeFrame(
            next.board,
            m.i,
            "白の応手",
            `白${coord(m.i)}が${stopped}。${remaining}`,
            [highlight([m.i], [], "danger"), highlight(continuation.cells)],
          ),
        );
      }
    }
    next.exercise = clone(continuation);
    next.nodeId = `compare-${choiceId}`;
    next.metrics.acceptedDecisions++;
    next.feedback = {
      ...next.feedback,
      kind: "continued",
      correct: true,
      title: continuation.title,
    };
    next.checkpoint = checkpoint(next);
    initializeHints(next, exerciseCandidates(next.board, continuation));
    return next;
  }
  next.transitionFrames = clone(c.frames);
  return completed(
    next,
    problem(state).completion === "local-goal" ? "local-goal" : "comparison",
    c.resultTitle,
    c.text,
  );
}
export function retryLearning(state) {
  if (state.status !== "feedback") return state;
  const next = clone(state);
  next.board = [...state.checkpoint.board];
  next.history = clone(state.checkpoint.history);
  next.nodeId = state.checkpoint.nodeId;
  next.status = "choose";
  next.feedback = emptyFeedback();
  next.transitionFrames = [];
  next.refutationFrames = [];
  next.metrics.retries++;
  const p = problem(next),
    guide = next.exercise
      ? exerciseCandidates(next.board, next.exercise)
      : next.history.length === 0
        ? p.guide
        : guideAfter(next);
  initializeHints(next, guide || []);
  return next;
}
export function hintLearning(state) {
  if (state.status !== "choose" || state.hints.level >= 3) return state;
  const next = clone(state);
  next.hints.level++;
  next.hints.uses++;
  next.hints.maxLevel = Math.max(next.hints.maxLevel, next.hints.level);
  next.hints.byDecision[hintKey(next)] = Math.max(
    next.hints.byDecision[hintKey(next)] || 0,
    next.hints.level,
  );
  return next;
}
export function hideLearningHints(state) {
  if (!state || state.hints.level === 0) return state;
  const next = clone(state);
  next.hints.level = 0;
  return next;
}
export function markLearningGuidance(state) {
  if (state.status !== "choose" || state.guidanceSeen) return state;
  const next = clone(state);
  next.guidanceSeen = true;
  return next;
}
export function getDemoFrames(unitId) {
  const u = byUnit.get(unitId);
  if (!u) throw Error(`単元がありません: ${unitId}`);
  return clone(u.lessonFrames);
}
export function getLearningView(state) {
  const p = problem(state),
    n = decision(state),
    continuationPrompt = p.continuationPrompts?.[state.exercise?.objective];
  const input =
    state.status !== "choose"
      ? "none"
      : state.exercise || n?.input !== "choice"
        ? "board"
        : "choice";
  let highlights = [];
  if (
    state.status === "choose" &&
    state.exercise?.cells.length &&
    p.questionHighlights
  )
    highlights = [{ cells: state.exercise.cells, points: [], tone: "focus" }];
  if (state.status === "choose" && input === "choice")
    highlights = p.questionHighlights || [];
  if (state.status === "choose" && state.hints.level)
    highlights = state.hintStages[state.hints.level - 1] || [];
  if (state.status === "solved")
    highlights =
      state.transitionFrames.at(-1)?.highlights || factHighlights(state.board);
  const resultFrame =
    state.status === "solved"
      ? state.transitionFrames.at(-1)
      : state.status === "feedback" && p.questionHighlights && !state.exercise
        ? state.refutationFrames.at(-1)
        : null;
  if (resultFrame) highlights = resultFrame.highlights || [];
  return clone({
    problemId: p.id,
    unitId: p.unitId,
    title: p.title,
    goal: state.exercise
      ? continuationPrompt || state.exercise.title
      : p.goal,
    kind: p.kind,
    goalKind: p.goalKind,
    input,
    choices:
      input === "choice"
        ? n.choices.map((c) => ({ id: c.id, title: c.title }))
        : [],
    board: resultFrame?.board || state.board,
    last: resultFrame ? resultFrame.last : (state.history.at(-1)?.i ?? null),
    highlights,
    status: state.status,
    canPlace: input === "board",
    canHint: state.status === "choose" && state.hints.level < 3,
    canRetry: state.status === "feedback",
    hintLevel: state.hints.level,
    hintText: state.hints.level
      ? state.hintTexts[state.hints.level - 1] || ""
      : "",
    guidanceSeen: state.guidanceSeen,
    feedback:
      state.status === "choose" && continuationPrompt
        ? { ...state.feedback, title: continuationPrompt }
        : state.feedback,
    transitionFrames: state.transitionFrames,
    refutationFrames: state.refutationFrames,
  });
}
function validMoves(moves) {
  return (
    Array.isArray(moves) &&
    moves.every((m) => m && validPoint(m.i) && (m.side === 1 || m.side === 2))
  );
}
function replayValid(p, history) {
  if (!validMoves(history)) return null;
  const b = [...p.board];
  for (let n = 0; n < history.length; n++) {
    const m = history[n];
    if (m.side !== (n % 2) + 1 || b[m.i] || winner(b)) return null;
    b[m.i] = m.side;
  }
  return b;
}
function validFrame(f) {
  return (
    f &&
    validBoard(f.board) &&
    (f.last === null || validPoint(f.last)) &&
    typeof f.title === "string" &&
    typeof f.text === "string" &&
    Array.isArray(f.highlights) &&
    f.highlights.every(
      (h) =>
        ["focus", "danger", "good"].includes(h.tone) &&
        Array.isArray(h.cells) &&
        Array.isArray(h.points) &&
        [...h.cells, ...h.points].every(validPoint),
    )
  );
}
export function restoreLearningAttempt(raw) {
  try {
    if (
      !raw ||
      raw.schemaVersion !== 1 ||
      raw.curriculumVersion !== curriculumVersion ||
      !byId.has(raw.problemId) ||
      !["choose", "feedback", "solved"].includes(raw.status)
    )
      return null;
    const p = byId.get(raw.problemId);
    if (!validBoard(raw.board) || !same(replayValid(p, raw.history), raw.board))
      return null;
    if (
      !raw.checkpoint ||
      !validBoard(raw.checkpoint.board) ||
      !same(replayValid(p, raw.checkpoint.history), raw.checkpoint.board)
    )
      return null;
    if (raw.attemptId !== null && typeof raw.attemptId !== "string")
      return null;
    if (typeof raw.guidanceSeen !== "boolean") return null;
    if (!Number.isInteger(raw.replyVariant) || raw.replyVariant < 0)
      return null;
    if (
      !raw.metrics ||
      ![
        "submittedDecisions",
        "acceptedDecisions",
        "verifiedMistakes",
        "unknownSelections",
        "retries",
      ].every((k) => Number.isInteger(raw.metrics[k]) && raw.metrics[k] >= 0)
    )
      return null;
    if (
      !raw.hints ||
      ![raw.hints.level, raw.hints.maxLevel].every(
        (n) => Number.isInteger(n) && n >= 0 && n <= 3,
      ) ||
      !Number.isInteger(raw.hints.uses) ||
      raw.hints.uses < 0 ||
      !raw.hints.byDecision ||
      typeof raw.hints.byDecision !== "object" ||
      Array.isArray(raw.hints.byDecision) ||
      !Object.values(raw.hints.byDecision).every(
        (n) => Number.isInteger(n) && n >= 0 && n <= 3,
      )
    )
      return null;
    if (
      !Array.isArray(raw.guide) ||
      !raw.guide.every(validPoint) ||
      !Array.isArray(raw.hintStages)
    )
      return null;
    if (
      !Array.isArray(raw.transitionFrames) ||
      !Array.isArray(raw.refutationFrames) ||
      ![...raw.transitionFrames, ...raw.refutationFrames].every(validFrame)
    )
      return null;
    if (
      !raw.feedback ||
      ![true, false, null].includes(raw.feedback.correct) ||
      ![
        "none",
        "continued",
        "completed",
        "goal-miss",
        "proven-loss",
        "unknown",
        "observation",
      ].includes(raw.feedback.kind)
    )
      return null;
    if (
      raw.status === "choose" &&
      (winner(raw.board) || raw.history.length % 2)
    )
      return null;
    if (raw.status === "solved") {
      if (raw.feedback.correct !== true || raw.feedback.kind !== "completed")
        return null;
      if (raw.feedback.claim === "win" && winner(raw.board) !== 1) return null;
      if (p.completion === "five" && winner(raw.board) !== 1) return null;
      if (
        raw.feedback.claim === "local-goal" &&
        p.judge.kind === "prevent-fork" &&
        (winPoints(raw.board, 2).length || forkMoves(raw.board, 2).length)
      )
        return null;
      if (p.nodes.some((n) => n.input === "choice") && !raw.exercise) {
        const selected = p.nodes
          .flatMap((n) => n.choices)
          .find((c) => c.id === raw.feedback.choiceId);
        if (!selected?.correct || selected.continuations?.length) return null;
      }
    }
    if (
      !raw.exercise &&
      p.nodes.some((n) => n.input === "choice") &&
      (raw.nodeId !== p.rootNodeId ||
        raw.history.length ||
        raw.feedback.kind === "continued")
    )
      return null;
    if (raw.exercise) {
      const choice = p.nodes
        .flatMap((n) => n.choices)
        .find(
          (c) =>
            c.correct &&
            raw.nodeId === `compare-${c.id}` &&
            c.continuations?.some((continuation) =>
              same(continuation, raw.exercise),
            ),
        );
      if (!choice) return null;
      const prefix = raw.exercise.moves;
      const matchesPrefix = (history) =>
        history.length >= prefix.length &&
        prefix.every(
          (move, index) =>
            history[index]?.i === move.i && history[index]?.side === move.side,
        );
      if (!matchesPrefix(raw.history) || !matchesPrefix(raw.checkpoint.history))
        return null;
      if (
        raw.history.length !==
        prefix.length + (raw.status === "choose" ? 0 : 1)
      )
        return null;
      if (raw.checkpoint.history.length !== prefix.length) return null;
      if (raw.checkpoint.nodeId !== raw.nodeId) return null;
      if (raw.status === "choose") {
        if (raw.feedback.move !== null) return null;
      } else if (raw.feedback.move !== raw.history.at(-1)?.i) return null;
      if (
        raw.status === "solved" &&
        !meetsExercise(raw.board, raw.exercise, raw.history.at(-1)?.i)
      )
        return null;
    }
    const state = clone(raw);
    // Older saved attempts may predate the causal feedback text. Rebuild it
    // without recording another decision or changing the attempt's evidence.
    if (
      state.status === "feedback" &&
      state.feedback.kind === "proven-loss" &&
      !state.feedback.text
    ) {
      const prior = winPoints(state.checkpoint.board, 1);
      const reply = state.refutationFrames.find(
        (f) => f.last !== null && f.board[f.last] === 2,
      );
      state.feedback.text =
        (prior.length
          ? `${prior.map(coord).join("・")}なら先に五連を作れた。`
          : "") +
        (reply
          ? winner(reply.board) === 2
            ? `この手には白${coord(reply.last)}で五連が完成する。`
            : `この手には白${coord(reply.last)}から攻めが続く。${reply.text}`
          : "相手の勝ち筋が残る。");
    }
    // Rebuild hint coordinates from trusted content/current board, not saved hints.
    if (state.status === "feedback") {
      const hintState = { ...state, ...state.checkpoint };
      const guide = hintState.exercise
        ? exerciseCandidates(hintState.board, hintState.exercise)
        : hintState.history.length === 0
          ? p.guide
          : guideAfter(hintState);
      initializeHints(hintState, guide || []);
      state.guide = hintState.guide;
      state.hintStages = hintState.hintStages;
      state.hintTexts = hintState.hintTexts;
    } else if (state.status === "choose") {
      const guide = state.exercise
        ? exerciseCandidates(state.board, state.exercise)
        : state.history.length === 0
          ? p.guide
          : guideAfter(state);
      initializeHints(state, guide || []);
    }
    return state;
  } catch {
    return null;
  }
}

export function createLearningProgress(raw = null) {
  if (
    !raw ||
    raw.schemaVersion !== 1 ||
    !raw.attempts ||
    typeof raw.attempts !== "object" ||
    Array.isArray(raw.attempts)
  )
    return {
      schemaVersion: 1,
      evidenceVersion: 2,
      curriculumVersion,
      nextOrdinal: 1,
      attempts: {},
      viewedUnits: [],
      exposures: [],
    };
  const result = {
    schemaVersion: 1,
    evidenceVersion: 2,
    curriculumVersion,
    nextOrdinal: 1,
    attempts: {},
    viewedUnits: [],
    exposures: [],
  };
  for (const [id, a] of Object.entries(raw.attempts)) {
    if (
      !id ||
      !a ||
      !byId.has(a.problemId) ||
      !Number.isInteger(a.ordinal) ||
      a.ordinal < 1 ||
      !["choose", "feedback", "solved"].includes(a.status)
    )
      continue;
    if (
      !["hints", "verifiedMistakes", "unknownSelections", "retries"].every(
        (k) => Number.isInteger(a[k]) && a[k] >= 0,
      )
    )
      continue;
    if (a.guidanceSeen !== undefined && typeof a.guidanceSeen !== "boolean")
      continue;
    result.attempts[id] = {
      ...clone(a),
      guidanceSeen: a.guidanceSeen === true,
      priorExposure: a.priorExposure === true,
      legacyEvidence:
        a.legacyEvidence === true ||
        raw.evidenceVersion !== 2 ||
        raw.curriculumVersion !== curriculumVersion,
      fingerprint: positionFingerprint(byId.get(a.problemId).board),
      family: byId.get(a.problemId).family,
      unitId: byId.get(a.problemId).unitId,
    };
    result.nextOrdinal = Math.max(result.nextOrdinal, a.ordinal + 1);
  }
  result.viewedUnits = [
    ...new Set(
      Array.isArray(raw.viewedUnits)
        ? raw.viewedUnits.filter((id) => byUnit.has(id))
        : [],
    ),
  ];
  result.exposures = [
    ...new Set(
      Array.isArray(raw.exposures)
        ? raw.exposures.filter(
            (value) => typeof value === "string" && value.startsWith("board:"),
          )
        : [],
    ),
  ];
  // Old viewed flags carry no timestamps. Conservatively retain their board
  // exposure; they never grant an independent first-encounter result.
  for (const unitId of result.viewedUnits) {
    for (const frame of byUnit.get(unitId).lessonFrames) {
      const fingerprint = positionFingerprint(frame.board);
      if (!result.exposures.includes(fingerprint))
        result.exposures.push(fingerprint);
    }
  }
  return result;
}
export function recordLearningAttempt(progress, state) {
  if (
    !state.attemptId ||
    state.curriculumVersion !== curriculumVersion ||
    !byId.has(state.problemId)
  )
    return progress;
  const next = createLearningProgress(progress),
    p = problem(state),
    prior = next.attempts[state.attemptId];
  if (prior && prior.problemId !== state.problemId) return progress;
  if (prior?.status === "solved" && state.status !== "solved") return progress;
  const ordinal = prior ? prior.ordinal : next.nextOrdinal++;
  const fingerprint = positionFingerprint(p.board);
  const previouslySeen =
    next.exposures.includes(fingerprint) ||
    Object.entries(next.attempts).some(
      ([id, a]) => id !== state.attemptId && a.fingerprint === fingerprint,
    );
  next.attempts[state.attemptId] = {
    problemId: p.id,
    unitId: p.unitId,
    family: p.family,
    ordinal,
    fingerprint,
    priorExposure:
      prior?.priorExposure === true ||
      ((!prior?.status || prior.status !== "solved") && previouslySeen),
    legacyEvidence: prior?.legacyEvidence === true,
    status: state.status,
    hints: Math.max(prior?.hints || 0, state.hints.uses),
    guidanceSeen: prior?.guidanceSeen === true || state.guidanceSeen === true,
    verifiedMistakes: Math.max(
      prior?.verifiedMistakes || 0,
      state.metrics.verifiedMistakes,
    ),
    unknownSelections: Math.max(
      prior?.unknownSelections || 0,
      state.metrics.unknownSelections,
    ),
    retries: Math.max(prior?.retries || 0, state.metrics.retries),
  };
  return next;
}
export function recordLessonView(progress, unitId) {
  if (!byUnit.has(unitId)) return progress;
  const next = createLearningProgress(progress);
  if (!next.viewedUnits.includes(unitId)) next.viewedUnits.push(unitId);
  for (const frame of byUnit.get(unitId).lessonFrames) {
    const fingerprint = positionFingerprint(frame.board);
    if (!next.exposures.includes(fingerprint)) next.exposures.push(fingerprint);
    for (const attempt of Object.values(next.attempts)) {
      if (attempt.status !== "solved" && attempt.fingerprint === fingerprint)
        attempt.priorExposure = true;
    }
  }
  return next;
}
export function recordBoardExposure(progress, board) {
  if (!validBoard(board)) return progress;
  const next = createLearningProgress(progress);
  const fingerprint = positionFingerprint(board);
  if (!next.exposures.includes(fingerprint)) next.exposures.push(fingerprint);
  for (const attempt of Object.values(next.attempts)) {
    if (attempt.status !== "solved" && attempt.fingerprint === fingerprint)
      attempt.priorExposure = true;
  }
  return next;
}
export function getLearningStats(progress, { problemId, unitId, family } = {}) {
  const p = createLearningProgress(progress),
    all = Object.values(p.attempts).sort((a, b) => a.ordinal - b.ordinal);
  const firstProblem = new Map(),
    firstFamily = new Map();
  for (const a of all) {
    if (!firstProblem.has(a.problemId))
      firstProblem.set(a.problemId, a.ordinal);
    if (!firstFamily.has(a.family)) firstFamily.set(a.family, a.ordinal);
  }
  const rows = all.filter(
    (a) =>
      (!problemId || a.problemId === problemId) &&
      (!unitId || a.unitId === unitId) &&
      (!family || a.family === family),
  );
  const done = rows.filter((a) => a.status === "solved");
  const clean = (a) =>
    !a.priorExposure &&
    !a.legacyEvidence &&
    !a.hints &&
    !a.guidanceSeen &&
    !a.verifiedMistakes &&
    !a.unknownSelections &&
    !a.retries;
  const latest = new Map();
  rows.forEach((a) => latest.set(a.problemId, a));
  const reviewProblemIds = [...latest.values()]
    .filter((a) => a.status !== "solved" || !clean(a))
    .map((a) => a.problemId);
  const completedProblemIds = [...new Set(done.map((a) => a.problemId))];
  const last = rows.at(-1);
  const lastOutcome = !last
    ? "new"
    : last.status !== "solved"
      ? "in-progress"
      : last.unknownSelections
        ? "unassessed"
        : last.hints || last.guidanceSeen
          ? "assisted"
          : last.verifiedMistakes || last.retries
            ? "retry"
            : "unaided";
  return {
    viewed: unitId ? p.viewedUnits.includes(unitId) : p.viewedUnits.length,
    started: rows.length,
    completed: done.length,
    firstEncounterCompleted: done.filter(
      (a) =>
        firstProblem.get(a.problemId) === a.ordinal &&
        !a.priorExposure &&
        !a.legacyEvidence,
    ).length,
    firstTryUnaided: done.filter(
      (a) => firstProblem.get(a.problemId) === a.ordinal && clean(a),
    ).length,
    familyFirstTryUnaided: done.filter(
      (a) => firstFamily.get(a.family) === a.ordinal && clean(a),
    ).length,
    assistedCompleted: done.filter((a) => a.hints > 0 || a.guidanceSeen).length,
    guidedCompleted: done.filter((a) => a.guidanceSeen).length,
    knownCompleted: done.filter((a) => a.priorExposure || a.legacyEvidence)
      .length,
    retryCompleted: done.filter(
      (a) => a.retries > 0 || firstProblem.get(a.problemId) !== a.ordinal,
    ).length,
    unknownEncountered: rows.filter((a) => a.unknownSelections > 0).length,
    completedProblemIds,
    completedProblems: completedProblemIds.length,
    problemCount: problems.filter(
      (p) =>
        (!problemId || p.id === problemId) &&
        (!unitId || p.unitId === unitId) &&
        (!family || p.family === family),
    ).length,
    verifiedMistakes: rows.reduce((n, a) => n + a.verifiedMistakes, 0),
    hintUses: rows.reduce((n, a) => n + a.hints, 0),
    independentCompleted: done.filter(clean).length,
    reviewProblemIds,
    needsReview: reviewProblemIds.length > 0,
    lastOutcome,
    cleanProblemIds: [...new Set(done.filter(clean).map((a) => a.problemId))],
  };
}
