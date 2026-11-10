export const N = 15,
  EMPTY = 0,
  BLACK = 1,
  WHITE = 2;
export const dirs = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];
export const index = (x, y) => y * N + x;
export const inside = (x, y) => x >= 0 && y >= 0 && x < N && y < N;
export const coord = (i) =>
  String.fromCharCode(65 + (i % N)) + (N - Math.floor(i / N));
export function parse(s) {
  const m = /^([A-O])(\d{1,2})$/i.exec(s);
  if (!m || +m[2] < 1 || +m[2] > 15) throw Error("Invalid coordinate");
  return index(m[1].toUpperCase().charCodeAt(0) - 65, N - Number(m[2]));
}
export function boardFrom(moves) {
  const b = new Uint8Array(N * N);
  for (let j = 0; j < moves.length; j++) {
    const i = typeof moves[j] === "number" ? moves[j] : moves[j].i;
    if (!Number.isInteger(i) || i < 0 || i >= 225 || b[i])
      throw Error("Invalid move");
    b[i] = (j % 2) + 1;
  }
  return b;
}
export function winningLine(b, i) {
  if (!b[i]) return [];
  const x = i % N,
    y = (i / N) | 0,
    c = b[i];
  for (const [dx, dy] of dirs) {
    const line = [i];
    for (const sign of [-1, 1]) {
      let xx = x + dx * sign,
        yy = y + dy * sign;
      while (inside(xx, yy) && b[index(xx, yy)] === c) {
        line.push(index(xx, yy));
        xx += dx * sign;
        yy += dy * sign;
      }
    }
    if (line.length >= 5) return line;
  }
  return [];
}
export function winner(b) {
  for (let i = 0; i < b.length; i++)
    if (b[i] && winningLine(b, i).length) return b[i];
  return 0;
}
export function winningMoves(b, c) {
  const out = [];
  for (let i = 0; i < 225; i++)
    if (!b[i]) {
      b[i] = c;
      if (winningLine(b, i).length) out.push(i);
      b[i] = 0;
    }
  return out;
}
export function classify(b, i, c) {
  if (b[i]) return { type: "occupied", text: "着手済み" };
  const own = winningMoves(b, c),
    opp = winningMoves(b, 3 - c);
  if (own.includes(i)) return { type: "win", text: "五連を完成", severity: 0 };
  if (own.length)
    return {
      type: "miss-win",
      text: "勝ちを見逃した",
      severity: 2,
      best: own[0],
    };
  if (opp.length > 1)
    return { type: "forced-loss", text: "既に受けきれない", severity: 0 };
  if (opp.length && !opp.includes(i))
    return {
      type: "miss-block",
      text: "相手の四を見逃した",
      severity: 3,
      best: opp[0],
    };
  b[i] = c;
  const threats = winningMoves(b, c),
    enemy = winningMoves(b, 3 - c);
  b[i] = 0;
  if (threats.length >= 2 && !enemy.length)
    return { type: "fork", text: "二つの勝ち筋", severity: 0 };
  if (opp.includes(i))
    return { type: "block", text: "相手の四を止めた", severity: 0 };
  if (threats.length)
    return { type: "four", text: "四で応手を強制", severity: 0 };
  return { type: "quiet", text: "形をつくる", severity: 0 };
}
// Sound, bounded continuous-four proof. Failure means unknown, never a proof of no win.
export function proveVCF(
  input,
  attacker,
  { maxPly = 9, maxNodes = 12000 } = {},
) {
  const b = Uint8Array.from(input);
  let nodes = 0,
    aborted = false;
  function visit(left) {
    if (++nodes > maxNodes) {
      aborted = true;
      return null;
    }
    const wins = winningMoves(b, attacker);
    if (wins.length) return { line: [wins[0]], plies: 1 };
    if (left < 3) return null;
    const danger = winningMoves(b, 3 - attacker);
    if (danger.length > 1) return null;
    const candidates = danger.length
      ? danger
      : Array.from({ length: 225 }, (_, i) => i).filter(
          (i) =>
            !b[i] &&
            dirs.some(([dx, dy]) => {
              let n = 0;
              for (let k = -4; k <= 4; k++) {
                const x = (i % 15) + k * dx,
                  y = Math.floor(i / 15) + k * dy;
                if (k && inside(x, y) && b[index(x, y)] === attacker) n++;
              }
              return n >= 3;
            }),
        );
    for (const i of candidates) {
      if (b[i]) continue;
      b[i] = attacker;
      const threats = winningMoves(b, attacker);
      if (!threats.length || winningMoves(b, 3 - attacker).length) {
        b[i] = 0;
        continue;
      }
      if (threats.length >= 2) {
        b[i] = 0;
        return { line: [i, threats[0], threats[1]], plies: 3 };
      }
      const defense = threats[0];
      b[defense] = 3 - attacker;
      const child = winningLine(b, defense).length ? null : visit(left - 2);
      b[defense] = 0;
      b[i] = 0;
      if (child)
        return { line: [i, defense, ...child.line], plies: child.plies + 2 };
      if (aborted) return null;
    }
    return null;
  }
  if (winner(b)) return { proven: false, nodes: 0, terminal: true };
  for (let depth = 1; depth <= maxPly; depth += 2) {
    const result = visit(depth);
    if (result)
      return { proven: true, ...result, nodes, scope: "continuous-four" };
    if (aborted) break;
  }
  return { proven: false, nodes, aborted };
}
export function tacticalAlternatives(b, c) {
  const wins = winningMoves(b, c);
  if (wins.length) return wins;
  const blocks = winningMoves(b, 3 - c);
  if (blocks.length) return blocks;
  return [];
}
export function validateRecord(r) {
  if (
    !r ||
    r.rule !== "freestyle15" ||
    !Array.isArray(r.moves) ||
    r.moves.length > 225
  )
    throw Error("対応していない棋譜");
  const moves = r.moves.map((m) => (typeof m === "number" ? m : m.i));
  const b = new Uint8Array(225);
  for (let j = 0; j < moves.length; j++) {
    const i = moves[j];
    if (!Number.isInteger(i) || i < 0 || i >= 225 || b[i] || winner(b))
      throw Error("棋譜の手順が不正です");
    b[i] = (j % 2) + 1;
  }
  if (!["normal", "strong", "max"].includes(r.level)) r.level = "strong";
  return {
    ...r,
    moves: moves.map((i) => ({ i })),
    analysis: {},
    result:
      winner(b) === 1
        ? "win"
        : winner(b) === 2
          ? "loss"
          : moves.length === 225
            ? "draw"
            : r.result === "resign"
              ? "resign"
              : "unfinished",
  };
}
