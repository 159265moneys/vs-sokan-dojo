import { winningLine } from "./game.js";

const axes = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];
const windows = [],
  sixes = [];
for (let y = 0; y < 15; y++)
  for (let x = 0; x < 15; x++)
    for (let axis = 0; axis < axes.length; axis++) {
      const [dx, dy] = axes[axis];
      for (const n of [5, 6]) {
        const endX = x + (n - 1) * dx,
          endY = y + (n - 1) * dy;
        if (endX < 0 || endX >= 15 || endY < 0 || endY >= 15) continue;
        const cells = Array.from(
          { length: n },
          (_, k) => (y + k * dy) * 15 + x + k * dx,
        );
        (n === 5 ? windows : sixes).push({ axis, cells });
      }
    }
const point = (i) => Number.isInteger(i) && i >= 0 && i < 225;
const validBoard = (b) =>
  b &&
  b.length === 225 &&
  Array.from(b).every((c) => c === 0 || c === 1 || c === 2);
export function completionPoints(board, side) {
  const out = new Set();
  for (const { cells } of windows) {
    let own = 0,
      gap = -1,
      blocked = false;
    for (const i of cells) {
      if (board[i] === side) own++;
      else if (board[i]) {
        blocked = true;
        break;
      } else gap = i;
    }
    if (!blocked && own === 4) out.add(gap);
  }
  return [...out].sort((a, b) => a - b);
}
function doubleThreats(board, side) {
  const candidates = new Set();
  for (const { cells } of windows)
    if (
      cells.filter((i) => board[i] === side).length === 3 &&
      cells.every((i) => !board[i] || board[i] === side)
    )
      for (const i of cells) if (!board[i]) candidates.add(i);
  return [...candidates].filter((i) => {
    const next = [...board];
    next[i] = side;
    return (
      completionPoints(next, side).length >= 2 &&
      !completionPoints(next, 3 - side).length
    );
  });
}
function connectionWitness(board, exercise, placed) {
  const specified = exercise.cells.filter((i) => i !== placed);
  const anchors = specified.length
    ? specified
    : Array.from(board, (_, i) => i).filter(
        (i) => i !== placed && board[i] === 1,
      );
  const candidates = windows.filter(
    ({ cells }) =>
      cells.includes(placed) &&
      cells.every((i) => board[i] !== 2) &&
      anchors.some((i) => cells.includes(i)),
  );
  for (let a = 0; a < candidates.length; a++)
    for (let b = a + 1; b < candidates.length; b++) {
      const first = candidates[a],
        second = candidates[b];
      if (first.axis === second.axis) continue;
      if (
        specified.length &&
        !specified.every(
          (i) => first.cells.includes(i) || second.cells.includes(i),
        )
      )
        continue;
      return {
        axes: [first.axis, second.axis],
        windows: [first.cells, second.cells],
      };
    }
  return null;
}
/** The board already contains the learner's last black stone. All goals are local. */
export function exerciseSatisfied(board, exercise, placed) {
  if (
    !validBoard(board) ||
    !exercise ||
    !point(placed) ||
    board[placed] !== 1 ||
    !Array.isArray(exercise.cells)
  )
    return false;
  if (winningLine(board, placed).length) return true;
  if (!exercise.cells.every((i) => point(i) && board[i] === 1)) return false;
  const required = [...exercise.cells, placed];
  if (exercise.objective === "five") return false;
  if (exercise.objective === "prevent-fork")
    return (
      !completionPoints(board, 2).length && !doubleThreats(board, 2).length
    );
  if (exercise.objective === "safe-four") {
    const finishes = completionPoints(board, 1);
    if (!finishes.length || completionPoints(board, 2).length) return false;
    if (finishes.length >= 2) return true;
    const reply = [...board];
    reply[finishes[0]] = 2;
    return (
      !winningLine(reply, finishes[0]).length &&
      !completionPoints(reply, 2).length
    );
  }
  if (exercise.objective === "two-directions")
    return (
      !completionPoints(board, 2).length &&
      !!connectionWitness(board, exercise, placed)
    );
  if (exercise.objective === "open-four") {
    if (completionPoints(board, 2).length) return false;
    const points = new Set();
    for (const { cells } of windows)
      if (
        required.every((i) => cells.includes(i)) &&
        cells.filter((i) => board[i] === 1).length === 4 &&
        cells.every((i) => board[i] !== 2)
      )
        points.add(cells.find((i) => board[i] === 0));
    return points.size >= 2;
  }
  if (exercise.objective === "four")
    return windows.some(
      ({ cells }) =>
        required.every((i) => cells.includes(i)) &&
        cells.filter((i) => board[i] === 1).length === 4 &&
        cells.every((i) => board[i] !== 2),
    );
  if (exercise.objective === "open-three")
    return sixes.some(({ cells }) => {
      if (board[cells[0]] || board[cells[5]]) return false;
      const middle = cells.slice(1, 5);
      return (
        required.every((i) => middle.includes(i)) &&
        middle.filter((i) => board[i] === 1).length === 3 &&
        middle.every((i) => board[i] !== 2)
      );
    });
  return false;
}
export function exerciseMoves(board, exercise) {
  if (!validBoard(board)) return [];
  const out = [];
  for (let i = 0; i < 225; i++)
    if (!board[i]) {
      const after = [...board];
      after[i] = 1;
      if (exerciseSatisfied(after, exercise, i)) out.push(i);
    }
  return out;
}
export function exerciseFacts(board, exercise, placed) {
  if (!exerciseSatisfied(board, exercise, placed)) return null;
  if (winningLine(board, placed).length)
    return { cells: winningLine(board, placed), points: [], axes: [] };
  if (exercise.objective === "two-directions") {
    const witness = connectionWitness(board, exercise, placed);
    return {
      cells: [...new Set(witness.windows.flat().filter((i) => board[i] === 1))],
      points: [],
      axes: witness.axes,
    };
  }
  const required = [...exercise.cells, placed];
  const lines = (exercise.objective === "open-three" ? sixes : windows).filter(
    ({ cells }) => {
      const active =
        exercise.objective === "open-three" ? cells.slice(1, 5) : cells;
      return (
        required.every((i) => active.includes(i)) &&
        active.every((i) => board[i] !== 2) &&
        active.filter((i) => board[i] === 1).length ===
          (exercise.objective === "open-three" ? 3 : 4) &&
        (exercise.objective !== "open-three" ||
          (!board[cells[0]] && !board[cells[5]]))
      );
    },
  );
  return {
    cells: [
      ...new Set(lines.flatMap((l) => l.cells).filter((i) => board[i] === 1)),
    ],
    points:
      exercise.objective === "open-three" ? [] : completionPoints(board, 1),
    axes: [...new Set(lines.map((l) => l.axis))],
  };
}
