import {
  boardFrom,
  coord,
  dirs,
  inside,
  index,
  parse,
  winningLine,
} from "./game.js";
import { completionPoints, lineShapes } from "./review-patterns.js";

// A move journal, not a prescribed solution. Only local, reproducible board
// facts are assessed; a quiet move is never treated as a proven loss.
const VERSION = 1;
const clone = (x) => JSON.parse(JSON.stringify(x));
function freeze(x) {
  if (x && typeof x === "object" && !Object.isFrozen(x)) {
    Object.values(x).forEach(freeze);
    Object.freeze(x);
  }
  return x;
}
const definitions = {
  "two-directions": ["二方向をつなぐ", "opening"],
  "switch-direction": ["残った方向を使う", "branch"],
  "build-threat": ["三・四を作る", "conditions"],
  "force-four": ["四で応手を絞る", "order"],
  "take-win": ["自分の五を先に", "priority"],
  "stop-five": ["白の五を止める", "priority"],
  "prevent-fork": ["二つの勝ち口を防ぐ", "defense"],
  "recover-after-defense": ["受けた石から展開", "counter"],
  "finish-five": ["五連まで指す", "practice"],
  "finish-game": ["終局まで指す", "practice"],
};
export const journeyTracks = freeze([
  {
    id: "build",
    title: "空盤から組み立てる",
    goal: "配置 → 方向転換 → 五連",
    unitIds: ["opening", "branch", "conditions", "order", "practice"],
    objectives: [
      "two-directions",
      "switch-direction",
      "build-threat",
      "force-four",
      "finish-five",
    ],
    stages: [
      {
        id: "build",
        title: "組み立てる",
        objectives: ["two-directions", "switch-direction"],
      },
      {
        id: "attack",
        title: "攻めへつなぐ",
        objectives: ["build-threat", "force-four"],
      },
      { id: "finish", title: "勝ち切る", objectives: ["finish-five"] },
    ],
    white: { ms: 700, strength: 65 },
  },
  {
    id: "defend",
    title: "受けて立て直す",
    goal: "優先判断 → 受け → 再構築",
    unitIds: ["priority", "defense", "counter", "practice"],
    objectives: [
      "stop-five",
      "prevent-fork",
      "recover-after-defense",
      "finish-game",
    ],
    stages: [
      {
        id: "read",
        title: "盤全体を読む",
        objectives: ["stop-five", "prevent-fork"],
      },
      {
        id: "recover",
        title: "立て直す",
        objectives: ["recover-after-defense"],
      },
      { id: "finish", title: "最後まで続ける", objectives: ["finish-game"] },
    ],
    white: { ms: 1500, strength: 85 },
  },
  {
    id: "practice",
    title: "一局を自分で",
    goal: "空盤 → 五連",
    unitIds: ["practice"],
    objectives: ["finish-five", "finish-game"],
    stages: [
      {
        id: "play",
        title: "一局を指す",
        objectives: ["finish-five", "finish-game"],
      },
    ],
    white: { ms: 8000, strength: 100 },
    unaided: true,
  },
  {
    id: "branch",
    title: "分岐から勝ち切る",
    goal: "つなぐ → 方向転換 → 五連",
    unitIds: ["branch", "order", "practice"],
    objectives: ["switch-direction", "force-four", "finish-five"],
    stages: [
      {
        id: "branch",
        title: "残った方向を使う",
        objectives: ["switch-direction"],
      },
      { id: "force", title: "四で応手を絞る", objectives: ["force-four"] },
      { id: "finish", title: "五連まで続ける", objectives: ["finish-five"] },
    ],
    sourceProblemId: "two-direction-fork",
    initialMoves: "F8 B3 G8 D4 H6 K12 H7 M13".split(" ").map(parse),
    replyVariants: ["E8", "H9", "I8", "H5"],
    white: { ms: 700, strength: 65 },
  },
]);
const tracks = new Map(journeyTracks.map((t) => [t.id, t]));
const trusted = new WeakSet();
const point = (i) => Number.isInteger(i) && i >= 0 && i < 225;
function legalMoves(input, { even = false, ongoing = false } = {}) {
  if (!Array.isArray(input) || input.length > 225)
    throw Error("手順が不正です");
  const moves = input.map((m) => (typeof m === "number" ? m : m?.i));
  const board = Array(225).fill(0);
  let won = 0;
  moves.forEach((i, n) => {
    if (!point(i) || board[i] || won) throw Error("手順が不正です");
    board[i] = (n % 2) + 1;
    if (winningLine(board, i).length) won = board[i];
  });
  if (even && moves.length % 2) throw Error("黒番の局面を選んでください");
  if (ongoing && (won || moves.length === 225)) throw Error("終局した局面です");
  return { moves, board, winner: won };
}
function variant(value = "natural", track = null) {
  if (track?.id === "branch") {
    const v = typeof value === "number" ? track.replyVariants[value] : value;
    if (!track.replyVariants.includes(v)) throw Error("応手設定が不正です");
    return v;
  }
  const v =
    typeof value === "number" ? ["natural", "H7", "G7", "H6"][value] : value;
  if (!["natural", "H7", "G7", "H6"].includes(v))
    throw Error("応手設定が不正です");
  return v;
}
function config(track, options) {
  if (!options || typeof options !== "object")
    throw Error("開始設定が不正です");
  const { moves, board } = legalMoves(
    options.initialMoves || track.initialMoves || [],
    { even: true, ongoing: true },
  );
  const sourceReview =
    options.sourceReview == null ? null : clone(options.sourceReview);
  if (sourceReview) {
    if (
      typeof sourceReview !== "object" ||
      Array.isArray(sourceReview) ||
      !Array.isArray(sourceReview.before) ||
      JSON.stringify(sourceReview.before) !== JSON.stringify(board) ||
      (sourceReview.ply != null && sourceReview.ply !== moves.length + 1)
    )
      throw Error("振り返りの局面と棋譜が一致しません");
  }
  const white = { ...track.white, ...options.white };
  if (
    !Number.isInteger(white.ms) ||
    white.ms < 50 ||
    white.ms > 30000 ||
    !Number.isInteger(white.strength) ||
    white.strength < 1 ||
    white.strength > 100
  )
    throw Error("CPU設定が不正です");
  const attemptId = options.attemptId ?? `${track.id}:local`;
  if (
    typeof attemptId !== "string" ||
    !attemptId.length ||
    attemptId.length > 256
  )
    throw Error("試行IDが不正です");
  return {
    attemptId,
    initialMoves: moves,
    sourceReview,
    replyVariant: variant(
      options.replyVariant ??
        (track.id === "branch" ? track.replyVariants[0] : "natural"),
      track,
    ),
    white: { ms: white.ms, strength: white.strength },
  };
}
function base(trackId, options) {
  const track = tracks.get(trackId);
  if (!track) throw Error("課題対局が見つかりません");
  const c = config(track, options);
  const assistance = [];
  if (!track.unaided)
    assistance.push({
      kind: "guided-journey",
      ply: c.initialMoves.length,
      branch: 0,
    });
  if (c.sourceReview)
    assistance.push({
      kind: "review-position",
      ply: c.initialMoves.length,
      branch: 0,
    });
  if (track.id === "branch")
    assistance.push({
      kind: "known-lesson-position",
      ply: c.initialMoves.length,
      branch: 0,
    });
  return {
    version: VERSION,
    trackId,
    id: c.attemptId,
    attemptId: c.attemptId,
    config: c,
    origin: c.sourceReview
      ? "review"
      : c.initialMoves.length
        ? "position"
        : "opening",
    startPly: c.initialMoves.length,
    fromOpening: !c.initialMoves.length && !c.sourceReview,
    moves: [...c.initialMoves],
    board: Array.from(boardFrom(c.initialMoves)),
    turn: 1,
    status: "playing",
    winner: 0,
    completed: false,
    journal: [],
    branch: 0,
    opportunities: [],
    mistakes: [],
    assistance,
    retries: 0,
    assisted: assistance.length > 0,
    openingOverride: null,
    branchOverride: null,
    plans: [],
    pendingSwitch: null,
    pendingRecovery: null,
    feedback: null,
  };
}
function seal(state) {
  freeze(state);
  trusted.add(state);
  return state;
}
export function createJourney(trackId, options = {}) {
  return seal(base(trackId, options));
}
function checked(state) {
  return trusted.has(state) ? state : restoreJourney(state);
}

// A connection is geometry with room for five, not a tactical winning claim.
function directionsAt(board, pivot) {
  if (board[pivot] !== 1) return [];
  const groups = [];
  dirs.forEach(([dx, dy], axis) => {
    const lines = [];
    for (let offset = -4; offset <= 0; offset++) {
      const cells = [];
      for (let k = 0; k < 5; k++) {
        const x = (pivot % 15) + (offset + k) * dx;
        const y = Math.floor(pivot / 15) + (offset + k) * dy;
        if (!inside(x, y)) break;
        cells.push(index(x, y));
      }
      if (
        cells.length === 5 &&
        !cells.some((i) => board[i] === 2) &&
        cells.filter((i) => board[i] === 1).length >= 2 &&
        cells.some((i) => !board[i])
      )
        lines.push(cells);
    }
    if (lines.length)
      groups.push({
        axis,
        lines,
        cells: [...new Set(lines.flat().filter((i) => board[i] === 1))],
        points: [...new Set(lines.flat().filter((i) => !board[i]))],
      });
  });
  return groups;
}
function formsFour(board, move, group, open = false) {
  if (!point(move) || board[move]) return false;
  const next = [...board];
  next[move] = 1;
  return lineShapes(next, 1).some(
    (shape) =>
      shape.kind === "four" &&
      shape.axis === group.axis &&
      shape.cells.includes(move) &&
      group.cells.every((i) => shape.cells.includes(i)) &&
      (!open || shape.points.length >= 2),
  );
}
function fourContinuations(board) {
  const groups = new Map();
  dirs.forEach(([dx, dy], axis) => {
    for (let y = 0; y < 15; y++)
      for (let x = 0; x < 15; x++) {
        if (!inside(x + 4 * dx, y + 4 * dy)) continue;
        const segment = Array.from({ length: 5 }, (_, k) =>
          index(x + k * dx, y + k * dy),
        );
        if (segment.some((i) => board[i] === 2)) continue;
        const cells = segment.filter((i) => board[i] === 1);
        if (cells.length !== 3) continue;
        const key = `${axis}:${cells.join(",")}`;
        const group = groups.get(key) || { axis, cells, points: [] };
        group.points = [
          ...new Set([...group.points, ...segment.filter((i) => !board[i])]),
        ];
        groups.set(key, group);
      }
  });
  return [...groups.values()];
}
function tacticalSwitch(before, after, reply, ply) {
  const blocked = lineShapes(before, 1).filter(
    (g) =>
      g.kind === "three" &&
      g.points.some((move) => formsFour(before, move, g, true)) &&
      !g.points.some((move) => formsFour(after, move, g, true)),
  );
  if (!blocked.length) return null;
  const blockedAxes = [...new Set(blocked.map((g) => g.axis))];
  const remaining = fourContinuations(after).filter(
    (g) => !blockedAxes.includes(g.axis),
  );
  if (!remaining.length) return null;
  const shared = blocked
    .flatMap((g) => g.cells)
    .find((i) => remaining.some((g) => g.cells.includes(i)));
  return {
    kind: "threat-continuation",
    scope: "blocked-open-three-then-other-four",
    pivot: shared ?? remaining[0].cells[0],
    planPly: ply - 1,
    reply,
    blockedAxes,
    blockedShapes: blocked,
    remaining,
  };
}
function switchGroups(plan, board, move) {
  if (!plan) return [];
  return plan.remaining.filter(
    (g) =>
      g.points.includes(move) &&
      (plan.kind === "threat-continuation"
        ? lineShapes(board, 1).some(
            (shape) =>
              shape.kind === "four" &&
              shape.axis === g.axis &&
              shape.cells.includes(move) &&
              g.cells.every((i) => shape.cells.includes(i)),
          )
        : directionsAt(board, plan.pivot).some((a) => a.axis === g.axis)),
  );
}
function teachingReply(s) {
  if (
    s.trackId !== "branch" ||
    s.turn !== 2 ||
    s.moves.length !== s.startPly + 1
  )
    return null;
  const i = parse(s.config.replyVariant);
  if (s.board[i]) return null;
  const threes = lineShapes(s.board, 1).filter(
    (g) =>
      g.kind === "three" &&
      g.points.some((move) => formsFour(s.board, move, g, true)),
  );
  if (new Set(threes.map((g) => g.axis)).size < 2) return null;
  const after = [...s.board];
  after[i] = 2;
  const plan = tacticalSwitch(s.board, after, i, s.moves.length + 1);
  if (
    !plan ||
    !plan.remaining.some(
      (g) =>
        threes.some(
          (t) =>
            t.axis === g.axis &&
            t.cells.every((cell) => g.cells.includes(cell)),
        ) && g.points.some((move) => formsFour(after, move, g, true)),
    )
  )
    return null;
  return {
    move: i,
    ply: s.moves.length + 1,
    variant: s.config.replyVariant,
    blockedAxes: plan.blockedAxes,
    remainingAxes: [...new Set(plan.remaining.map((g) => g.axis))],
    scope: plan.scope,
  };
}
function forkThreats(input) {
  const board = [...input];
  const out = [];
  for (let i = 0; i < 225; i++) {
    if (board[i]) continue;
    const candidate = dirs.some(([dx, dy]) => {
      let own = 0;
      for (let k = -4; k <= 4; k++) {
        const x = (i % 15) + dx * k,
          y = Math.floor(i / 15) + dy * k;
        if (k && inside(x, y) && board[index(x, y)] === 2) own++;
      }
      return own >= 3;
    });
    if (!candidate) continue;
    board[i] = 2;
    const points = completionPoints(board, 2);
    if (
      !winningLine(board, i).length &&
      points.length >= 2 &&
      !completionPoints(board, 1).length
    ) {
      const shapes = lineShapes(board, 2).filter((g) => g.kind === "four");
      out.push({
        move: i,
        points,
        kind: shapes.some((g) => g.points.length >= 2)
          ? "open-four"
          : "double-four",
        cells: [...new Set(shapes.flatMap((g) => g.cells))],
      });
    }
    board[i] = 0;
  }
  return out;
}
function observe(s, objectiveId, outcome, evidence, kind = objectiveId) {
  const item = {
    objectiveId,
    unitId: definitions[objectiveId][1],
    ply: s.moves.length,
    branch: s.branch,
    kind,
    outcome,
    success:
      outcome === "achieved" ? true : outcome === "missed" ? false : null,
    evidence,
    retracted: false,
  };
  s.opportunities.push(item);
  return item;
}
function mistake(s, kind, evidence) {
  s.mistakes.push({
    kind,
    ply: s.moves.length,
    branch: s.branch,
    evidence,
    retracted: false,
  });
}
function feedback(kind, title, highlights = [], facts = {}) {
  return { kind, title, text: "", highlights, facts };
}
const highlight = (cells = [], points = [], tone = "focus") => ({
  cells,
  points,
  tone,
});
const axisNames = ["横", "縦", "右下がりの斜め", "右上がりの斜め"];
const coordinates = (points) => [...new Set(points)].map(coord).join("・");
const axes = (groups) =>
  [...new Set(groups.map((g) => axisNames[g.axis]))].join("と");
function nearby(points, center, limit = 3) {
  return [...new Set(points)]
    .sort(
      (a, b) =>
        Math.max(
          Math.abs((a % 15) - (center % 15)),
          Math.abs(Math.floor(a / 15) - Math.floor(center / 15)),
        ) -
          Math.max(
            Math.abs((b % 15) - (center % 15)),
            Math.abs(Math.floor(b / 15) - Math.floor(center / 15)),
          ) || a - b,
    )
    .slice(0, limit);
}
function connectionOptions(board) {
  const options = [];
  for (let i = 0; i < 225; i++)
    if (!board[i]) {
      const next = [...board];
      next[i] = 1;
      const groups = directionsAt(next, i);
      if (groups.length >= 2) options.push({ move: i, groups });
    }
  return options;
}
function candidateDescription(s, i) {
  const before = s.board,
    board = [...before];
  board[i] = 1;
  const own = completionPoints(before, 1),
    enemy = completionPoints(before, 2);
  const ownAfter = completionPoints(board, 1),
    enemyAfter = completionPoints(board, 2);
  const groups = directionsAt(board, i),
    shapes = lineShapes(board, 1).filter((g) => g.cells.includes(i));
  let item;
  if (winningLine(board, i).length) {
    item = {
      kind: "five",
      title: "五連になる",
      text: `黒${coord(i)}で${coordinates(winningLine(board, i))}の五連が完成する。`,
      highlights: [highlight(winningLine(board, i), [], "good")],
    };
  } else if (own.length) {
    item = {
      kind: "miss-win",
      title: "今の五連と比べる",
      text: `${coordinates(own)}ならこの一手で五連。黒${coord(i)}では、今ある勝ちを完成させない。`,
      highlights: [highlight([], own, "good")],
    };
  } else if (enemyAfter.length) {
    item = {
      kind: "miss-block",
      title: "白の完成点が残る",
      text: `黒${coord(i)}の後も、白は${coordinates(enemyAfter)}で五連にできる。${enemy.length > 1 ? "着手前から完成点が二つ以上あり、一手では全部を塞げない。" : "その完成点を塞ぐ候補と比べよう。"}`,
      highlights: [highlight([], enemyAfter, "danger")],
    };
  } else {
    const threatsAfter = forkThreats(board);
    const threatsBefore = enemy.length ? [] : forkThreats(before);
    if (threatsAfter.length) {
      const t = threatsAfter[0];
      item = {
        kind: "allow-fork",
        title: "白に二つの勝ち口を残す",
        text: `黒${coord(i)}の後、白${coord(t.move)}で${coordinates(t.points)}が五連の完成点になる。黒は一手で両方を塞げない。`,
        highlights: [
          highlight(
            t.cells.filter((p) => board[p]),
            [t.move],
            "danger",
          ),
        ],
        facts: { threat: t, assessment: "local-white-fork" },
      };
    } else if (enemy.length) {
      item = {
        kind: "block",
        title: "白の五連を止める",
        text: `黒${coord(i)}が白の完成点を塞ぐ。${shapes.length ? `${coordinates(shapes[0].cells)}の黒石も${shapes[0].kind === "four" ? "四" : "三"}につながる。` : "次はこの受け石を使える方向を比べよう。"}`,
        highlights: [highlight([i], [], "good")],
      };
    } else if (threatsBefore.length) {
      item = {
        kind: "prevent-fork",
        title: "白の二つの勝ち口を防ぐ",
        text: `黒${coord(i)}で、白${coordinates(threatsBefore.map((t) => t.move))}から二つの完成点を作る形を防ぐ。次に受けた石と他の黒石をつなげよう。`,
        highlights: [highlight([i], [], "good")],
      };
    } else if (switchGroups(s.pendingSwitch, board, i).length) {
      const used = switchGroups(s.pendingSwitch, board, i),
        plan = s.pendingSwitch;
      item = {
        kind: "switch-direction",
        title: `残った${axes(used)}を使う`,
        text:
          plan.kind === "threat-continuation"
            ? `白${coord(plan.reply)}が${plan.blockedAxes.map((axis) => axisNames[axis]).join("と")}の三から両端四へ伸びる形を止めた。黒${coord(i)}は残った${axes(used)}の三を四にして、${coordinates(ownAfter)}に五連の完成点を作る。`
            : `白${coord(plan.reply)}で止まった方向を離れ、黒${coord(i)}は${coord(plan.pivot)}から${axes(used)}につながる。`,
        highlights: [
          highlight([...new Set(used.flatMap((g) => g.cells)), i], ownAfter),
        ],
        facts: { scope: plan.scope || "connection-geometry-only" },
      };
    } else if (ownAfter.length) {
      item = {
        kind: "four",
        title: "四で応手を絞る",
        text: `黒${coord(i)}で${coordinates(ownAfter)}が五連の完成点になる。${ownAfter.length > 1 ? "白は一手で全部を塞げない。" : "白がこの点を塞いだ後の別方向まで比べよう。"}`,
        highlights: [
          highlight(
            shapes.flatMap((g) => g.cells),
            ownAfter,
            "good",
          ),
        ],
      };
    } else if (groups.length >= 2) {
      item = {
        kind: "connection",
        title: "二方向につながる",
        text: `黒${coord(i)}は${coordinates(groups.flatMap((g) => g.cells).filter((p) => p !== i))}へ、${axes(groups)}の別々の方向でつながる。白の石を挟まない伸び先を比べよう。`,
        highlights: [highlight([...new Set(groups.flatMap((g) => g.cells))])],
        facts: { groups, scope: "connection-geometry-only" },
      };
    } else if (shapes.length) {
      const shape = shapes[0];
      item = {
        kind: "three",
        title: "三を作る",
        text: `黒${coord(i)}で${coordinates(shape.cells)}が${axisNames[shape.axis]}の三になる。${coordinates(shape.points)}へ伸ばす手と、外側の空きを確かめよう。`,
        highlights: [highlight(shape.cells, shape.points)],
      };
    } else if (groups.length) {
      const g = groups[0];
      item = {
        kind: "connect",
        title: `${axisNames[g.axis]}につながる`,
        text: `黒${coord(i)}は${coordinates(g.cells.filter((p) => p !== i))}と${axisNames[g.axis]}につながる。${coordinates(nearby(g.points, i))}などの空きを次に使える。`,
        highlights: [highlight(g.cells)],
        facts: { groups, scope: "connection-geometry-only" },
      };
    } else {
      const next = connectionOptions(board).filter((p) =>
        p.groups.some((g) => g.cells.includes(i)),
      );
      const sample = nearby(
        next.map((p) => p.move),
        i,
      );
      item = sample.length
        ? {
            kind: "prepare-connection",
            title: "次の連結点を残す",
            text: `黒${coord(i)}と他の黒石を、${coordinates(sample)}から異なる方向でつなげられる。次に使う交点を比べよう。`,
            highlights: [highlight([i], sample)],
            facts: { scope: "connection-geometry-only" },
          }
        : {
            kind: "placement",
            title: "ここから組み立てる",
            text: before.some((v) => v === 1)
              ? `黒${coord(i)}は既存の黒石と、五路の空いた線ではまだつながらない。別の候補を仮置きして、つながる自石と伸び先を比べよう。`
              : `黒${coord(i)}を起点にする。次の黒石をつなぐ縦・横・斜めの空きを見よう。`,
            highlights: [highlight([i])],
            facts: { assessment: "unknown" },
          };
    }
  }
  return {
    ...item,
    board,
    last: i,
    move: i,
    hypothetical: true,
    proofScope: "local-board-facts",
  };
}

/** Compare a proposed move without appending a move or a goal observation. */
export function previewJourneyMove(state, i) {
  const s = checked(state);
  if (
    tracks.get(s.trackId).unaided ||
    s.completed ||
    s.turn !== 1 ||
    !point(i) ||
    s.board[i]
  )
    return null;
  return clone(candidateDescription(s, i));
}

function instructionFor(s) {
  if (tracks.get(s.trackId).unaided) return null;
  const shapeMarks = (groups, tone = "good", scope = "shape-only") =>
    groups.map((g) => ({
      ...highlight(
        g.cells,
        g.points.filter((i) => !s.board[i]),
        tone,
      ),
      motif: true,
      lines: [g.cells],
      scope,
    }));
  const geometryMarks = (cells, points = []) =>
    cells.length
      ? [
          {
            ...highlight([...new Set(cells)], points),
            motif: false,
            scope: "connection-geometry-only",
          },
        ]
      : [];
  if (s.completed)
    return {
      title: "この一局を振り返る",
      text: "届いた目標と、まだ現れなかった場面を確かめよう。",
      highlights: [],
    };
  if (s.turn !== 1)
    return {
      title: "白の応手を見る",
      text: "白が塞ぐ方向と、新しく作る形を見よう。",
      highlights: [],
    };
  const own = completionPoints(s.board, 1),
    enemy = completionPoints(s.board, 2);
  if (own.length)
    return {
      title: "自分の五を先に",
      text: `${coordinates(own)}は黒の五連の完成点。相手を受ける前に、今の一手で勝てる点を選ぼう。`,
      highlights: shapeMarks(
        lineShapes(s.board, 1).filter((g) => g.kind === "four"),
      ),
    };
  if (enemy.length)
    return {
      title: enemy.length > 1 ? "白に二つの完成点" : "白の五を先に受ける",
      text:
        enemy.length > 1
          ? `白は${coordinates(enemy)}で五連にでき、一手では全部を塞げない。やり直すなら、その形を許した黒番へ戻ろう。`
          : `白は${coordinates(enemy)}で五連にできる。この交点を塞いだ後、置いた黒石をどちらへ使えるか見よう。`,
      highlights: shapeMarks(
        lineShapes(s.board, 2).filter((g) => g.kind === "four"),
        "danger",
      ),
    };
  const threats = forkThreats(s.board);
  if (threats.length)
    return {
      title: "白の次の四を読む",
      text: `白${coordinates(threats.map((t) => t.move))}から二つの勝ち口ができる。交点や外側を塞ぐ候補を仮置きして比べよう。`,
      highlights: threats.map((t) => {
        const after = [...s.board];
        after[t.move] = 2;
        const lines = lineShapes(after, 2)
          .filter((g) => g.kind === "four" && g.cells.includes(t.move))
          .map((g) => g.cells.filter((i) => s.board[i] === 2));
        return {
          ...highlight([...new Set(lines.flat())], [t.move], "danger"),
          motif: true,
          lines,
          critical: t.move,
          scope: "verified-next-white-fork",
        };
      }),
    };
  if (s.pendingSwitch) {
    const p = s.pendingSwitch,
      remaining = axes(p.remaining),
      candidates = nearby(
        p.remaining.flatMap((g) => g.points),
        p.pivot,
      );
    if (p.kind === "threat-continuation")
      return {
        title: `残った${remaining}を四へ`,
        text: `白${coord(p.reply)}で${p.blockedAxes.map((axis) => axisNames[axis]).join("と")}の三から両端四への伸びが止まった。${coordinates(candidates)}など、残る${remaining}の三を四にする候補を比べよう。`,
        highlights: shapeMarks(
          p.remaining,
          "good",
          "verified-four-continuation",
        ),
      };
    return {
      title: `残った${remaining}へ`,
      text: `白${coord(p.reply)}で${p.blockedAxes.map((axis) => axisNames[axis]).join("と")}が止まった。${coordinates(candidates)}など、${coord(p.pivot)}から残る${remaining}へ延ばす手を比べよう。`,
      highlights: geometryMarks(
        p.remaining.flatMap((g) => g.cells),
        candidates,
      ),
    };
  }
  if (s.pendingRecovery) {
    const pivot = s.pendingRecovery.point,
      groups = directionsAt(s.board, pivot);
    const shapes = lineShapes(s.board, 1).filter((g) =>
      g.cells.includes(pivot),
    );
    return {
      title: "受けた石を使う",
      text: groups.length
        ? `受けた${coord(pivot)}は${coordinates(groups.flatMap((g) => g.cells).filter((i) => i !== pivot))}とつながる。${axes(groups)}へ延ばし、三・四を作る候補を比べよう。`
        : `受けた${coord(pivot)}と他の黒石を結ぶ交点を探そう。白の石を挟まない縦・横・斜めを仮置きで比べよう。`,
      highlights: shapes.length
        ? shapeMarks(shapes)
        : geometryMarks(
            groups.length ? groups.flatMap((g) => g.cells) : [pivot],
          ),
    };
  }
  const stones = s.moves.filter((_, n) => n % 2 === 0);
  if (!stones.length)
    return {
      title: "最初の黒石を置く",
      text: "盤の中央付近で、周囲に伸ばせる空きがある交点を選ぼう。",
      highlights: [],
    };
  if (stones.length === 1)
    return {
      title: "一つつないで、余地を残す",
      text: `${coord(stones[0])}と縦・横・斜めでつながる近い交点を比べよう。次に別の方向へつなぐ空きも残そう。`,
      highlights: geometryMarks(stones),
    };
  const connections = connectionOptions(s.board);
  if (
    stones.length === 2 ||
    !s.opportunities.some(
      (o) => !o.retracted && o.objectiveId === "two-directions" && o.success,
    )
  ) {
    const sample = nearby(
      connections.map((p) => p.move),
      stones.at(-1),
    );
    return {
      title: "二方向の連結点を選ぶ",
      text: sample.length
        ? `${coordinates(sample)}など、二つの黒石に異なる方向からつながる交点を比べよう。相手が一方を塞いだ後に使う空きも確かめよう。`
        : `${coordinates(stones.slice(-2))}を起点に、別の黒石をつなぐ空きを探そう。白を挟む方向を避け、次に二方向へつなげる配置を比べよう。`,
      highlights: geometryMarks(stones.slice(-2), sample),
    };
  }
  const threes = lineShapes(s.board, 1).filter((g) => g.kind === "three");
  if (threes.length)
    return {
      title: "三を四へつなぐ",
      text: `${coordinates(threes[0].cells)}は${axisNames[threes[0].axis]}の三。${coordinates(threes[0].points)}へ伸ばす候補と、白が受ける点を比べよう。`,
      highlights: shapeMarks([threes[0]]),
    };
  const recent = stones.at(-1),
    groups = directionsAt(s.board, recent);
  return {
    title: "つないだ石を三へ",
    text: groups.length
      ? `${coord(recent)}から${axes(groups)}へ伸ばす候補を比べよう。同じ方向に三つつなぐときは、その外側の空きも確かめよう。`
      : `${coord(recent)}と他の黒石から、白を挟まない線を探そう。次に三つつながる配置を仮置きして比べよう。`,
    highlights: geometryMarks(
      groups.length ? groups.flatMap((g) => g.cells) : [recent],
    ),
  };
}
function safePrevention(board, threats) {
  // A witnessed alternative is required before assigning a preventable mistake.
  // Failure to find one here is unknown; it is not a forced-loss assessment.
  const candidates = [
    ...new Set(threats.flatMap((t) => [t.move, ...t.points, ...t.cells])),
  ];
  for (const i of candidates) {
    if (board[i]) continue;
    const next = [...board];
    next[i] = 1;
    if (
      winningLine(next, i).length ||
      (!completionPoints(next, 2).length && !forkThreats(next).length)
    )
      return i;
  }
  return null;
}
function blackFacts(s, before, i) {
  const board = s.board,
    own = completionPoints(before, 1),
    enemy = completionPoints(before, 2);
  const won = winningLine(board, i).length > 0;
  const ownAfter = completionPoints(board, 1),
    enemyAfter = completionPoints(board, 2);
  const threats = !own.length && !enemy.length ? forkThreats(before) : [];
  const threatsAfter = !won && !enemyAfter.length ? forkThreats(board) : [];
  const locallySafe = won || (!enemyAfter.length && !threatsAfter.length);
  s.feedback = feedback("unknown", "次の一手へ", [], { assessment: "unknown" });
  if (own.length) {
    observe(s, "take-win", won ? "achieved" : "missed", {
      points: own,
      played: i,
    });
    if (!won) {
      mistake(s, "miss-win", { points: own, played: i });
      s.feedback = feedback(
        "miss-win",
        "五連の完成点があった",
        [highlight([], own, "good")],
        { points: own },
      );
    }
  } else if (enemy.length) {
    const stopped = !enemyAfter.length;
    const outcome = stopped
      ? "achieved"
      : enemy.length === 1
        ? "missed"
        : "unknown";
    observe(s, "stop-five", outcome, {
      points: enemy,
      remaining: enemyAfter,
      played: i,
    });
    if (stopped) {
      s.pendingRecovery = { ply: s.moves.length, point: i };
      s.feedback = feedback("block", "白の五連を止めた", [
        highlight([i], [], "good"),
      ]);
    } else if (outcome === "missed") {
      mistake(s, "miss-block", {
        points: enemyAfter,
        played: i,
        line: [enemyAfter[0]],
        scope: "immediate-white-win",
      });
      s.feedback = feedback(
        "miss-block",
        "白の完成点が残る",
        [highlight([], enemyAfter, "danger")],
        { points: enemyAfter },
      );
    } else
      s.feedback = feedback(
        "already-two-wins",
        "白に二つの完成点",
        [highlight([], enemyAfter, "danger")],
        { assessment: "already-present" },
      );
  } else if (threats.length) {
    const stopped = locallySafe;
    const alternative = stopped ? i : safePrevention(before, threats);
    const outcome = stopped
      ? "achieved"
      : alternative !== null
        ? "missed"
        : "unknown";
    observe(s, "prevent-fork", outcome, {
      before: threats,
      remaining: threatsAfter,
      played: i,
      alternative,
    });
    if (stopped) {
      s.pendingRecovery = { ply: s.moves.length, point: i };
      s.feedback = feedback("prevent-fork", "二つの勝ち口を防いだ", [
        highlight([i], [], "good"),
      ]);
    } else if (outcome === "missed") {
      const t = threatsAfter[0];
      const evidence = {
        ...t,
        played: i,
        alternative,
        line: [t.move, t.points[0], t.points[1]],
        scope: "white-fork-then-five",
      };
      mistake(s, "allow-fork", evidence);
      s.feedback = feedback(
        "allow-fork",
        "白に二つの勝ち口の狙い",
        [
          highlight(
            t.cells.filter((p) => board[p]),
            [t.move],
            "danger",
          ),
        ],
        evidence,
      );
    }
  }
  const groups = directionsAt(board, i);
  if (!won && groups.length >= 2 && locallySafe) {
    observe(s, "two-directions", "achieved", {
      pivot: i,
      groups,
      scope: "connection-geometry-only",
    });
    s.plans.push({ pivot: i, ply: s.moves.length, groups });
    if (s.feedback.kind === "unknown")
      s.feedback = feedback(
        "connection",
        "二方向の連携",
        [highlight([...new Set(groups.flatMap((g) => g.cells))])],
        { groups, scope: "geometry-only" },
      );
  }
  if (s.pendingSwitch && !own.length && !enemy.length && !threats.length) {
    const p = s.pendingSwitch;
    const used = switchGroups(p, board, i).length > 0;
    observe(
      s,
      "switch-direction",
      used && locallySafe ? "achieved" : "unknown",
      { ...p, played: i },
    );
    if (
      used &&
      locallySafe &&
      ["unknown", "connection"].includes(s.feedback.kind)
    )
      s.feedback = feedback(
        "switch-direction",
        `残った${axes(switchGroups(p, board, i))}へ`,
        [highlight([p.pivot, i])],
      );
    s.pendingSwitch = null;
  } else if (s.pendingSwitch) s.pendingSwitch = null;
  const shapes = lineShapes(board, 1).filter((g) => g.cells.includes(i));
  if (!won && shapes.length && locallySafe) {
    observe(s, "build-threat", "achieved", {
      move: i,
      shapes,
      scope: "shape-only",
    });
    if (
      s.pendingRecovery &&
      s.moves.length > s.pendingRecovery.ply &&
      shapes.some((g) => g.cells.includes(s.pendingRecovery.point))
    ) {
      observe(s, "recover-after-defense", "achieved", {
        defense: s.pendingRecovery,
        move: i,
        shapes,
      });
      s.pendingRecovery = null;
    }
  }
  if (!won && ownAfter.length && !enemyAfter.length) {
    observe(s, "force-four", "achieved", {
      move: i,
      points: ownAfter,
      shapes: shapes.filter((g) => g.kind === "four"),
      scope: "answer-or-lose-next-move",
    });
    if (["unknown", "connection"].includes(s.feedback.kind))
      s.feedback = feedback("four", "四で応手を絞る", [
        highlight(
          shapes.flatMap((g) => g.cells),
          ownAfter,
          "good",
        ),
      ]);
  }
  if (won) {
    observe(s, "finish-five", "achieved", { line: winningLine(board, i) });
    s.feedback = feedback("five", "五連", [
      highlight(winningLine(board, i), [], "good"),
    ]);
  }
}
function whiteFacts(s, before, i) {
  if (
    s.moves.length === 2 &&
    s.config.replyVariant !== "natural" &&
    i === parse(s.config.replyVariant)
  )
    s.openingOverride = { move: i, ply: 2, variant: s.config.replyVariant };
  const prescribed = teachingReply({
    ...s,
    board: before,
    moves: s.moves.slice(0, -1),
    turn: 2,
  });
  if (prescribed?.move === i) s.branchOverride = prescribed;
  s.feedback = feedback("reply", "白の応手", [], { move: i });
  const stopped = completionPoints(before, 1).includes(i);
  const shapes = lineShapes(s.board, 2).filter((g) => g.cells.includes(i));
  s.feedback.text = stopped
    ? `白${coord(i)}が黒の五連の完成点を塞いだ。残った黒石から別方向へのつながりを見直そう。`
    : shapes.length
      ? `白${coord(i)}で${coordinates(shapes[0].cells)}が${axisNames[shapes[0].axis]}の${shapes[0].kind === "four" ? "四" : "三"}になった。${coordinates(shapes[0].points)}への伸びを確かめよう。`
      : `白${coord(i)}の後は、黒${coord(s.moves.at(-2))}からつながる縦・横・斜めを比べ直そう。`;
  const actualSwitch = tacticalSwitch(before, s.board, i, s.moves.length);
  if (actualSwitch) {
    s.pendingSwitch = actualSwitch;
    s.feedback = feedback(
      "direction-blocked",
      "白が三の伸びを止めた",
      [highlight([i], [], "danger")],
      { blockedAxes: actualSwitch.blockedAxes, scope: actualSwitch.scope },
    );
    s.feedback.text = `白${coord(i)}で${actualSwitch.blockedAxes.map((axis) => axisNames[axis]).join("と")}の三から両端四への伸びが止まった。${axes(actualSwitch.remaining)}には三を四にする手が残る。`;
  }
  for (const plan of actualSwitch ? [] : [...s.plans].reverse()) {
    const prev = directionsAt(before, plan.pivot),
      after = directionsAt(s.board, plan.pivot);
    const blocked = prev.filter((g) => !after.some((a) => a.axis === g.axis));
    if (prev.length >= 2 && blocked.length && after.length) {
      s.pendingSwitch = {
        scope: "connection-geometry-only",
        pivot: plan.pivot,
        planPly: plan.ply,
        reply: i,
        blockedAxes: blocked.map((g) => g.axis),
        remaining: after,
      };
      s.feedback = feedback(
        "direction-blocked",
        "白が一方向を止めた",
        [highlight([i], [], "danger")],
        { blockedAxes: blocked.map((g) => g.axis) },
      );
      s.feedback.text = `白${coord(i)}で${coord(plan.pivot)}からの${axes(blocked)}が止まった。${axes(after)}へのつながりは残る。`;
      break;
    }
  }
  const lastMistake = [...s.mistakes]
    .reverse()
    .find((m) => !m.retracted && m.ply === s.moves.length - 1);
  if (
    lastMistake &&
    (lastMistake.evidence.move === i ||
      lastMistake.evidence.points?.includes(i))
  ) {
    const shapes = lineShapes(s.board, 2).filter((g) => g.cells.includes(i));
    s.feedback = feedback(
      "actual-counter",
      "白の反撃",
      [
        highlight(
          [...new Set(shapes.flatMap((g) => g.cells))],
          completionPoints(s.board, 2),
          "danger",
        ),
      ],
      {
        actualReply: i,
        mistake: lastMistake.kind,
        witness: lastMistake.evidence,
      },
    );
    s.feedback.text = `白${coord(i)}で${coordinates(completionPoints(s.board, 2))}が五連の完成点になった。${completionPoints(s.board, 2).length > 1 ? "黒は一手で全部を塞げない。" : "この完成点を受ける必要がある。"}`;
  }
  if (winningLine(s.board, i).length) {
    s.feedback = feedback(
      "white-five",
      "白の五連",
      [highlight(winningLine(s.board, i), [], "danger")],
      { actualReply: i },
    );
    s.feedback.text = `白${coord(i)}で${coordinates(winningLine(s.board, i))}が五連になった。`;
  }
}
function move(s, event, side) {
  if (s.completed || s.turn !== side || !point(event.i) || s.board[event.i])
    throw Error("この手は打てません");
  const before = [...s.board];
  const compared =
    side === 1 && !tracks.get(s.trackId).unaided
      ? candidateDescription(s, event.i)
      : null;
  s.moves.push(event.i);
  s.board[event.i] = side;
  if (side === 1) blackFacts(s, before, event.i);
  else whiteFacts(s, before, event.i);
  if (compared) {
    s.feedback.text = compared.text;
    if (s.feedback.kind === "unknown")
      s.feedback = {
        ...feedback(
          compared.kind,
          compared.title,
          compared.highlights,
          compared.facts,
        ),
        text: compared.text,
      };
  }
  s.winner = winningLine(s.board, event.i).length ? side : 0;
  s.completed = !!s.winner || s.moves.length === 225;
  s.turn = s.completed ? null : 3 - side;
  s.status = s.completed ? "completed" : s.turn === 1 ? "playing" : "reply";
  if (s.completed)
    observe(s, "finish-game", "achieved", {
      winner: s.winner,
      plies: s.moves.length,
    });
}
function apply(s, event) {
  if (!event || typeof event !== "object")
    throw Error("保存された操作が不正です");
  if (event.type === "move" || event.type === "reply") {
    if (Object.keys(event).sort().join() !== "i,type")
      throw Error("保存された操作が不正です");
    move(s, event, event.type === "move" ? 1 : 2);
  } else if (event.type === "assistance") {
    if (
      Object.keys(event).sort().join() !== "kind,type" ||
      typeof event.kind !== "string" ||
      !event.kind.length ||
      event.kind.length > 80
    )
      throw Error("補助記録が不正です");
    s.assistance.push({
      kind: event.kind,
      ply: s.moves.length,
      branch: s.branch,
    });
    s.assisted = true;
  } else if (event.type === "retry") {
    if (
      Object.keys(event).sort().join() !== "toPly,type" ||
      !Number.isInteger(event.toPly) ||
      event.toPly % 2 ||
      event.toPly < s.startPly ||
      event.toPly >= s.moves.length
    )
      throw Error("戻る局面が不正です");
    for (const item of [...s.opportunities, ...s.mistakes])
      if (!item.retracted && item.ply > event.toPly) item.retracted = true;
    s.moves = s.moves.slice(0, event.toPly);
    s.board = Array.from(boardFrom(s.moves));
    s.plans = s.plans.filter((p) => p.ply <= event.toPly);
    s.pendingSwitch = null;
    const recoveryEvents = s.opportunities.filter(
      (o) =>
        !o.retracted &&
        o.outcome === "achieved" &&
        ["stop-five", "prevent-fork", "recover-after-defense"].includes(
          o.objectiveId,
        ),
    );
    const recovery = recoveryEvents.at(-1);
    s.pendingRecovery =
      recovery && recovery.objectiveId !== "recover-after-defense"
        ? { ply: recovery.ply, point: recovery.evidence.played }
        : null;
    s.completed = false;
    s.winner = 0;
    s.turn = 1;
    s.status = "playing";
    s.retries++;
    s.assisted = true;
    s.assistance.push({ kind: "retry", ply: event.toPly, branch: s.branch });
    s.branch++;
    if (event.toPly < 2) s.openingOverride = null;
    if (event.toPly <= s.startPly) s.branchOverride = null;
    if (event.toPly >= 2)
      whiteFacts(
        s,
        Array.from(boardFrom(s.moves.slice(0, -1))),
        s.moves.at(-1),
      );
    s.feedback = feedback("retry", "もう一度この局面から");
  } else throw Error("保存された操作が不正です");
  s.journal.push(clone(event));
  return s;
}
function change(state, event) {
  return seal(apply(clone(checked(state)), event));
}
export function playJourneyMove(state, i) {
  return change(state, { type: "move", i });
}
export function applyJourneyReply(state, i) {
  return change(state, { type: "reply", i });
}
export function markJourneyAssistance(state, kind = "hint") {
  return change(state, { type: "assistance", kind });
}
function retryPly(s) {
  const error = [...s.mistakes]
    .reverse()
    .find((m) => !m.retracted && m.ply > s.startPly);
  return error
    ? error.ply - 1
    : s.moves.length > s.startPly
      ? Math.floor((s.moves.length - 1) / 2) * 2
      : null;
}
export function retryJourney(state, toPly) {
  const s = checked(state);
  return change(s, { type: "retry", toPly: toPly ?? retryPly(s) });
}
export function restoreJourney(saved) {
  if (
    !saved ||
    saved.version !== VERSION ||
    !Array.isArray(saved.journal) ||
    saved.journal.length > 4000
  )
    throw Error("課題対局の保存データが不正です");
  const s = base(saved.trackId, saved.config);
  for (const event of saved.journal) apply(s, event);
  // Derived evidence is replayed, never trusted from local storage.
  const canonical = (value) =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, canonical(value[key])]),
          )
        : value;
  if (JSON.stringify(canonical(s)) !== JSON.stringify(canonical(saved)))
    throw Error("課題対局の保存データが一致しません");
  return seal(s);
}
function objectiveViews(s) {
  return Object.entries(definitions).map(([id, [title, unitId]]) => {
    const observed = s.opportunities.filter(
      (o) => o.objectiveId === id && !o.retracted,
    );
    return {
      id,
      title,
      unitId,
      status: observed.some((o) => o.outcome === "achieved")
        ? "achieved"
        : observed.length
          ? "observed"
          : "not-observed",
      opportunities: observed.length,
      achieved: observed.filter((o) => o.outcome === "achieved").length,
      required: tracks.get(s.trackId).objectives.includes(id),
    };
  });
}
export function getJourneyResult(state) {
  const s = checked(state),
    objectives = objectiveViews(s),
    track = tracks.get(s.trackId);
  const achievedObjectives = objectives
    .filter((o) => o.status === "achieved")
    .map((o) => o.id);
  return clone({
    id: s.id,
    attemptId: s.attemptId,
    trackId: s.trackId,
    origin: s.origin,
    startPly: s.startPly,
    fromOpening: s.fromOpening,
    sourceReview: s.config.sourceReview,
    sourceProblemId: track.sourceProblemId || null,
    moves: s.moves,
    replyVariant: s.config.replyVariant,
    openingOverride: s.openingOverride,
    branchOverride: s.branchOverride,
    white: {
      ...s.config.white,
      kind: s.branchOverride
        ? "teaching-branch"
        : s.openingOverride
          ? "seeded-opening"
          : "natural",
    },
    result:
      s.winner === 1
        ? "win"
        : s.winner === 2
          ? "loss"
          : s.completed
            ? "draw"
            : "unfinished",
    winner: s.winner,
    completed: s.completed,
    assisted: s.assisted,
    retries: s.retries,
    assistance: s.assistance,
    achievedObjectives,
    objectives,
    opportunities: s.opportunities,
    mistakes: s.mistakes,
    goalEvents: s.opportunities,
    goalMet:
      s.completed &&
      track.objectives.every((id) => achievedObjectives.includes(id)) &&
      (!track.unaided || !s.assisted),
    proofScope: "local-board-facts",
  });
}
export function getJourneyView(state) {
  const s = checked(state),
    track = tracks.get(s.trackId),
    objectives = objectiveViews(s);
  const achieved = new Set(
    objectives.filter((o) => o.status === "achieved").map((o) => o.id),
  );
  const stage =
    track.stages.find(
      (stage) => !stage.objectives.every((id) => achieved.has(id)),
    ) || track.stages.at(-1);
  const openingMove =
    s.fromOpening &&
    s.moves.length === 1 &&
    s.config.replyVariant !== "natural" &&
    !s.board[parse(s.config.replyVariant)]
      ? parse(s.config.replyVariant)
      : null;
  const teaching = teachingReply(s);
  const shownFeedback =
    track.unaided && !s.completed
      ? feedback("play", s.turn === 1 ? "黒番" : "白番")
      : s.feedback;
  const instruction = instructionFor(s);
  return clone({
    board: s.board,
    moves: s.moves,
    last: s.moves.at(-1) ?? null,
    status: s.status,
    turn: s.turn,
    needsReply: s.status === "reply",
    completed: s.completed,
    winner: s.winner,
    title: track.title,
    goal: track.goal,
    stage,
    objectives: objectives.filter((o) => o.required),
    instruction,
    feedback: shownFeedback,
    highlights:
      s.turn === 1 && instruction
        ? instruction.highlights
        : shownFeedback?.highlights || [],
    canRetry: retryPly(s) !== null,
    retryPly: retryPly(s),
    assisted: s.assisted,
    replyConfig: {
      ...s.config.white,
      openingMove,
      teachingMove: teaching?.move ?? null,
      kind: teaching
        ? "teaching-branch"
        : openingMove !== null
          ? "seeded-opening"
          : "natural",
    },
  });
}
