import { boardFrom, winner } from "./game.js";
// A legal protocol representation of an authored snapshot, not a claim about
// how a human reached it. Callers must keep startPly/origin and omit setup plies
// from performance review and empty-board match statistics.
export function positionMoves(board) {
  if (
    !Array.isArray(board) ||
    board.length !== 225 ||
    board.some((c) => ![0, 1, 2].includes(c)) ||
    winner(board)
  )
    throw Error("開始局面が不正です");
  const black = [],
    white = [];
  board.forEach((c, i) => {
    if (c === 1) black.push(i);
    if (c === 2) white.push(i);
  });
  if (black.length !== white.length) throw Error("黒番の局面が必要です");
  const moves = black.flatMap((i, j) => [i, white[j]]);
  if (Array.from(boardFrom(moves)).some((c, i) => c !== board[i]))
    throw Error("開始局面を再現できません");
  return moves;
}
export function reviewStartPly(record) {
  const n = record?.startPly;
  return Number.isInteger(n) &&
    n >= 0 &&
    n % 2 === 0 &&
    n <= record.moves.length
    ? n
    : 0;
}
