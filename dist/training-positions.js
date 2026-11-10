import {
  coord,
  parse,
  dirs,
  inside,
  index,
  winner,
  winningLine,
  winningMoves,
  proveVCF,
} from "./game.js";
import { transformPoint } from "./lessons.js";

const points = (s) => s.split(" ").filter(Boolean).map(parse);
const cores = {
  five: ["H8 I8 J8 K8", "G8"],
  block: ["F8", "G8 H8 I8 J8"],
  openfour: ["G8 H8 I8", ""],
  doublefour: ["F8 G8 I8 H6 H7 H9", ""],
  chain: ["H6 H7 H9 G8 I8", "H5"],
  outside: ["F8 G8 I8 H6 H7 H9 A2", "B2 C2 D2 E2"],
  overline: ["E8 F8 G8 I8 J8", ""],
  "live-three": ["", "G8 H8 I8"],
  "broken-three": ["", "G8 I8 J8"],
};

function hash(value) {
  let h = 2166136261;
  for (const c of String(value)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
function seededRandom(seed) {
  let value = hash(seed);
  return () => {
    value += 0x6d2b79f5;
    let t = Math.imul(value ^ (value >>> 15), value | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function chooseInt(rng, min, max) {
  return min + Math.min(max - min, Math.floor(rng() * (max - min + 1)));
}
function distance(a, b) {
  return Math.max(
    Math.abs((a % 15) - (b % 15)),
    Math.abs(Math.floor(a / 15) - Math.floor(b / 15)),
  );
}
function shuffled(values, rng) {
  const result = [...values];
  for (let j = result.length - 1; j > 0; j--) {
    const k = chooseInt(rng, 0, j);
    [result[k], result[j]] = [result[j], result[k]];
  }
  return result;
}

// A new four must use at least three existing stones along one direction.
// This is only candidate enumeration; every result below is checked on the board.
function fourCandidates(board, color) {
  return Array.from({ length: 225 }, (_, i) => i).filter(
    (i) =>
      !board[i] &&
      dirs.some(([dx, dy]) => {
        let count = 0;
        for (let k = -4; k <= 4; k++) {
          const x = (i % 15) + k * dx,
            y = Math.floor(i / 15) + k * dy;
          if (k && inside(x, y) && board[index(x, y)] === color) count++;
        }
        return count >= 3;
      }),
  );
}

export function openFourMoves(input, color = 2) {
  const board = Uint8Array.from(input),
    result = [];
  for (const i of fourCandidates(board, color)) {
    board[i] = color;
    if (!winningLine(board, i).length && winningMoves(board, color).length >= 2)
      result.push(i);
    board[i] = 0;
  }
  return result;
}

function goalType(lesson) {
  return lesson.theme === "early-defense"
    ? "prevent-open-four"
    : lesson.theme === "defense"
      ? "stop-five"
      : "force-win";
}

function continuation(board, move) {
  const next = Uint8Array.from(board);
  next[move] = 1;
  if (winningLine(next, move).length) return { done: true, threats: [] };
  if (winningMoves(next, 2).length) return null;
  const threats = winningMoves(next, 1);
  if (threats.length >= 2) return { done: false, threats };
  if (threats.length === 1) {
    next[threats[0]] = 2;
    const proof = proveVCF(next, 1, { maxPly: 7, maxNodes: 300 });
    if (proof.proven) return { done: false, threats, proof };
  }
  return null;
}

export function trainingAnswers(board, type = "force-win") {
  if (winner(board)) return [];
  const wins = winningMoves(board, 1);
  if (wins.length) return wins;
  if (type === "stop-five") {
    const danger = winningMoves(board, 2);
    return danger.length === 1 ? danger : [];
  }
  if (type === "prevent-open-four") {
    const result = [];
    // A defensive stone has to occupy either a gain square or a future win point
    // of an existing open-four threat. Other squares cannot remove that threat.
    const candidates = new Set();
    const next = Uint8Array.from(board);
    for (const threat of openFourMoves(board, 2)) {
      candidates.add(threat);
      next[threat] = 2;
      winningMoves(next, 2).forEach((i) => candidates.add(i));
      next[threat] = 0;
    }
    for (const i of candidates) {
      next[i] = 1;
      if (!winningMoves(next, 2).length && !openFourMoves(next, 2).length)
        result.push(i);
      next[i] = 0;
    }
    return result.sort((a, b) => a - b);
  }
  const danger = winningMoves(board, 2);
  if (danger.length > 1) return [];
  return (danger.length ? danger : fourCandidates(board, 1)).filter((i) =>
    continuation(board, i),
  );
}

function checkAuthoredSteps(board, steps, type) {
  const next = Uint8Array.from(board);
  for (let j = 0; j < steps.length; j++) {
    const i = steps[j].i;
    if (next[i] || winner(next)) return false;
    next[i] = (j % 2) + 1;
  }
  return type !== "force-win" || winner(next) === 1;
}

export function makeTrainingPosition(lesson, { rng, transform, seed } = {}) {
  rng ||= seed === undefined ? Math.random : seededRandom(seed);
  const type = goalType(lesson);
  const rawCore = cores[lesson.id] || null;
  const core = rawCore ? rawCore.map(points) : [lesson.black, lesson.white];
  const sourceCritical = [
    ...core.flat(),
    ...lesson.answers,
    ...lesson.steps.flatMap((s) => [s.i, ...s.marks]),
  ];
  for (let attempt = 0; attempt < 80; attempt++) {
    const t =
      transform === undefined
        ? chooseInt(rng, 0, 7)
        : ((transform % 8) + 8) % 8;
    const rotated = sourceCritical.map((i) => transformPoint(i, t));
    const xs = rotated.map((i) => i % 15),
      ys = rotated.map((i) => Math.floor(i / 15));
    const dx = chooseInt(rng, -Math.min(...xs), 14 - Math.max(...xs));
    const dy = chooseInt(rng, -Math.min(...ys), 14 - Math.max(...ys));
    const map = (i) => transformPoint(i, t) + dx + 15 * dy;
    // Retrieval diversity measures the tactical geometry, not harmless filler.
    // Sorting also collapses symmetric transforms with identical colored stones.
    const geometry = core
      .map((stones) =>
        stones
          .map(map)
          .sort((a, b) => a - b)
          .join("."),
      )
      .join("/");
    const board = new Uint8Array(225);
    core.forEach((stones, side) =>
      stones.forEach((i) => {
        board[map(i)] = side + 1;
      }),
    );
    const reserved = [...new Set(sourceCritical.map(map))];
    const occupied = reserved.slice();
    const fillers = [
      lesson.black.length - core[0].length,
      lesson.white.length - core[1].length,
    ];
    let placed = true;
    for (let color = 1; color <= 2; color++) {
      const candidates = shuffled(
        Array.from({ length: 225 }, (_, i) => i),
        rng,
      );
      for (let n = 0; n < fillers[color - 1]; n++) {
        const i = candidates.find(
          (p) => !board[p] && occupied.every((q) => distance(p, q) >= 3),
        );
        if (i === undefined) {
          placed = false;
          break;
        }
        board[i] = color;
        occupied.push(i);
      }
      if (!placed) break;
    }
    if (!placed || winner(board)) continue;
    const steps = lesson.steps.map((s) => ({
      ...s,
      i: map(s.i),
      move: coord(map(s.i)),
      marks: s.marks.map(map),
      text: s.text.replace(/[A-O](?:1[0-5]|[1-9])(?!\d)/g, (coordinate) =>
        coord(map(parse(coordinate))),
      ),
    }));
    if (!checkAuthoredSteps(board, steps, type)) continue;
    const answers = trainingAnswers(board, type);
    if (
      !answers.length ||
      lesson.answers.some((i) => !answers.includes(map(i)))
    )
      continue;
    if (type === "force-win" && winningMoves(board, 2).length) continue;
    if (
      type === "prevent-open-four" &&
      (winningMoves(board, 1).length || winningMoves(board, 2).length)
    )
      continue;
    return {
      lessonId: lesson.id,
      board,
      variantId: `${lesson.id}:${type}:${geometry}`,
      label: lesson.short,
      goal:
        type === "force-win"
          ? "四を続けて五連まで"
          : type === "stop-five"
            ? "次の五連を防ぐ"
            : "次の活四を防ぐ",
      answers,
      steps,
      metadata: {
        transform: t,
        dx,
        dy,
        scope: "local-tactic",
        goalType: type,
        completeStrategy: false,
      },
    };
  }
  throw Error("練習局面を生成できませんでした");
}

export function createTacticalPosition({
  board: input,
  kind,
  id = "game-review",
}) {
  if (
    !input ||
    input.length !== 225 ||
    !Array.from(input).every((c) => c === 0 || c === 1 || c === 2)
  )
    throw Error("練習局面が不正です");
  const board = Uint8Array.from(input);
  const black = Array.from(board).filter((c) => c === 1).length;
  const white = Array.from(board).filter((c) => c === 2).length;
  if (black !== white || winner(board))
    throw Error("黒番の未終局局面が必要です");
  const type =
    kind === "miss-win"
      ? "force-win"
      : kind === "miss-block"
        ? "stop-five"
        : null;
  if (!type) throw Error("この見落としには対応していません");
  const ownWins = winningMoves(board, 1),
    enemyWins = winningMoves(board, 2);
  if (kind === "miss-win" && !ownWins.length)
    throw Error("即勝ちの局面ではありません");
  if (kind === "miss-block" && (ownWins.length || enemyWins.length !== 1))
    throw Error("一手で防げる四の局面が必要です");
  const geometry = [1, 2]
    .map((color) =>
      Array.from(board, (cell, i) => (cell === color ? i : -1))
        .filter((i) => i >= 0)
        .join("."),
    )
    .join("/");
  return {
    lessonId: kind === "miss-win" ? "five" : "block",
    board,
    variantId: `record:${kind}:${geometry}`,
    label: "実戦の見落とし",
    goal: kind === "miss-win" ? "五連を完成させる" : "次の五連を防ぐ",
    answers: kind === "miss-win" ? ownWins : enemyWins,
    steps: [],
    metadata: {
      scope: "record-tactic",
      goalType: type,
      completeStrategy: false,
      kind,
      sourceId: id,
    },
  };
}

export function createTrainingState(position, { defenseChoice = 0 } = {}) {
  return {
    position,
    board: Uint8Array.from(position.board),
    ply: 0,
    done: false,
    last: -1,
    whiteMove: null,
    defenseChoice,
    answers: [...position.answers],
  };
}

function wrongMove(state, i) {
  const board = Uint8Array.from(state.board),
    type = state.position.metadata.goalType;
  const wins = winningMoves(board, 1);
  if (wins.length)
    return {
      feedback: `${coord(wins[0])}で五連。今ある勝ちを決め切る。`,
      refutation: wins[0],
      refutationColor: 1,
    };
  board[i] = 1;
  const danger = winningMoves(board, 2);
  if (danger.length)
    return {
      feedback: `白${coord(danger[0])}で五連。先にこの勝ち口を閉じる。`,
      refutation: danger[0],
      refutationColor: 2,
    };
  if (type === "prevent-open-four") {
    const fork = openFourMoves(board, 2)[0];
    if (fork !== undefined)
      return {
        feedback: `白${coord(fork)}で両端の空いた四。三のうちに止める。`,
        refutation: fork,
        refutationColor: 2,
      };
  }
  const threats = winningMoves(board, 1);
  if (threats.length === 1)
    return {
      feedback: `白${coord(threats[0])}が防御。この課題は、そこから続く四まで読む。`,
      refutation: threats[0],
      refutationColor: 2,
    };
  return {
    feedback: "この課題は四を続ける攻め。二つの勝ち口につながる一手を探す。",
    refutation: null,
    refutationColor: null,
  };
}

// Pure transition: a correct attack automatically receives one legal defense.
// defenderChoice cycles through all immediate defensive endpoints across variants.
export function judgeTrainingMove(state, i) {
  if (
    state.done ||
    !Number.isInteger(i) ||
    i < 0 ||
    i >= 225 ||
    state.board[i]
  ) {
    return {
      correct: false,
      done: state.done,
      state,
      feedback: "空いている交点を選ぶ。",
      refutation: null,
      whiteMove: null,
    };
  }
  if (!state.answers.includes(i))
    return {
      correct: false,
      done: false,
      state,
      whiteMove: null,
      ...wrongMove(state, i),
    };
  const board = Uint8Array.from(state.board);
  board[i] = 1;
  const type = state.position.metadata.goalType;
  let done = type !== "force-win" || !!winningLine(board, i).length;
  let whiteMove = null,
    ply = state.ply + 1;
  if (!done) {
    const threats = winningMoves(board, 1);
    whiteMove =
      threats[
        ((state.defenseChoice % threats.length) + threats.length) %
          threats.length
      ];
    board[whiteMove] = 2;
    ply++;
  }
  const answers = done ? [] : trainingAnswers(board, type);
  const next = {
    ...state,
    board,
    ply,
    done,
    last: whiteMove ?? i,
    blackMove: i,
    whiteMove,
    answers,
  };
  return {
    correct: true,
    done,
    state: next,
    whiteMove,
    refutation: null,
    feedback: done
      ? type === "force-win"
        ? "五連まで読み切った。"
        : "次の脅威を止めた。"
      : `白${coord(whiteMove)}。続きの黒を選ぶ。`,
  };
}
