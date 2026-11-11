import {
  parse,
  coord,
  proveVCF,
  winningMoves as appWinningMoves,
  winner as appWinner,
} from "../dist/game.js";

// Independent >=5 implementation: every contiguous length-five window.
const windows = [];
const byCell = Array.from({ length: 225 }, () => []);
for (let y = 0; y < 15; y++)
  for (let x = 0; x < 15; x++)
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, -1],
    ]) {
      if (
        x + 4 * dx < 0 ||
        x + 4 * dx >= 15 ||
        y + 4 * dy < 0 ||
        y + 4 * dy >= 15
      )
        continue;
      const w = Array.from(
        { length: 5 },
        (_, k) => (y + k * dy) * 15 + x + k * dx,
      );
      windows.push(w);
      for (const i of w) byCell[i].push(w);
    }
const wins = (b, c) => {
  const out = new Set();
  for (const w of windows) {
    let own = 0,
      blank = -1,
      blocked = false;
    for (const i of w) {
      if (b[i] === 3 - c) {
        blocked = true;
        break;
      }
      if (b[i] === c) own++;
      else blank = i;
    }
    if (!blocked && own === 4) out.add(blank);
  }
  return [...out].sort((a, b) => a - b);
};
const won = (b, c) => windows.some((w) => w.every((i) => b[i] === c));
const empties = (b) =>
  Array.from({ length: 225 }, (_, i) => i).filter((i) => !b[i]);
const mk = (black, white) => {
  const b = new Uint8Array(225);
  for (const s of black) b[parse(s)] = 1;
  for (const s of white) {
    if (b[parse(s)]) throw Error("duplicate");
    b[parse(s)] = 2;
  }
  return b;
};
const labels = (a) => a.map(coord);
function vcf(b, c, maxPly = 9, budget = 100000) {
  let nodes = 0,
    aborted = false;
  const visit = (left) => {
    if (++nodes > budget) {
      aborted = true;
      return null;
    }
    const w = wins(b, c);
    if (w.length) return [w[0]];
    if (left < 3) return null;
    const danger = wins(b, 3 - c);
    if (danger.length > 1) return null;
    const possible = new Set();
    for (const w of windows) {
      let own = 0,
        bad = false;
      for (const i of w) {
        if (b[i] === 3 - c) {
          bad = true;
          break;
        }
        if (b[i] === c) own++;
      }
      if (!bad && own === 3) for (const i of w) if (!b[i]) possible.add(i);
    }
    const candidates = danger.length ? danger : [...possible];
    for (const i of candidates) {
      b[i] = c;
      const attacks = wins(b, c),
        counter = wins(b, 3 - c);
      if (attacks.length && !counter.length) {
        if (attacks.length >= 2) {
          b[i] = 0;
          return [i, attacks[0], attacks[1]];
        }
        const d = attacks[0];
        b[d] = 3 - c;
        const sub = won(b, 3 - c) ? null : visit(left - 2);
        b[d] = 0;
        if (sub) {
          b[i] = 0;
          return [i, d, ...sub];
        }
      }
      b[i] = 0;
      if (aborted) return null;
    }
    return null;
  };
  for (let depth = 1; depth <= maxPly; depth += 2) {
    const line = visit(depth);
    if (line)
      return { proven: true, line: labels(line), plies: line.length, nodes };
    if (aborted) break;
  }
  return { proven: false, nodes, aborted };
}
function allReplies(b, first, maxPly = 9) {
  const i = parse(first);
  if (b[i]) throw Error("occupied");
  b[i] = 1;
  const out = [];
  for (const j of empties(b)) {
    b[j] = 2;
    const result = won(b, 2)
      ? { proven: false, whiteWins: true }
      : vcf(b, 1, maxPly);
    out.push({ reply: coord(j), ...result });
    b[j] = 0;
  }
  b[i] = 0;
  return {
    first,
    all: out.length,
    proved: out.filter((x) => x.proven).length,
    unproved: out.filter((x) => !x.proven),
    maxPlies:
      1 + 1 + Math.max(0, ...out.filter((x) => x.proven).map((x) => x.plies)),
    branches: out,
  };
}
function firstFours(b, maxPly = 9) {
  const out = [];
  for (const i of empties(b)) {
    b[i] = 1;
    const own = wins(b, 1);
    const opp = wins(b, 2);
    if (own.length) {
      let result;
      if (opp.length) result = { proven: false, whiteImmediate: labels(opp) };
      else if (own.length >= 2)
        result = {
          proven: true,
          line: [coord(i), ...labels(own.slice(0, 2))],
          plies: 3,
        };
      else {
        b[own[0]] = 2;
        result = vcf(b, 1, maxPly - 2);
        b[own[0]] = 0;
        if (result.proven) {
          result.line = [coord(i), coord(own[0]), ...result.line];
          result.plies += 2;
        }
      }
      out.push({ first: coord(i), ...result });
    }
    b[i] = 0;
  }
  return out;
}
const problems = [
  {
    id: "turning-vcf",
    black: ["C8", "D8", "E8", "F5", "F6", "G7", "H7"],
    white: ["B8", "F4", "I8", "J10", "H10", "L12", "K13"],
    first: "F8",
  },
  {
    id: "quiet-dual-vcf",
    black: ["D8", "E8", "F6", "F7", "H11", "H12", "I11", "J12"],
    white: ["C8", "D5", "J8", "L11", "H13", "L10", "M13", "B4"],
    first: "H8",
  },
  {
    id: "dual-duty-defense",
    black: ["C8", "D8", "E8", "F5", "F6", "G7", "H7", "A13", "J4", "L5", "M8"],
    white: [
      "B8",
      "F4",
      "I8",
      "J10",
      "H10",
      "L12",
      "K13",
      "E9",
      "D10",
      "C11",
      "B12",
    ],
    first: "F8",
  },
];
const reports = [];
for (const p of problems) {
  const b = mk(p.black, p.white);
  const app = proveVCF(b, 1, { maxPly: 11, maxNodes: 100000 });
  const r = {
    ...p,
    windowCount: windows.length,
    counts: [p.black.length, p.white.length],
    terminal: won(b, 1) || won(b, 2),
    immediate: [labels(wins(b, 1)), labels(wins(b, 2))],
    independent: VCFWrap(b),
    app: { ...app, line: app.line && labels(app.line) },
    fours: firstFours(b, 11),
    allReplies: allReplies(b, p.first, 11),
  };
  reports.push(r);
  console.log(
    JSON.stringify({
      ...r,
      allReplies: { ...r.allReplies, branches: undefined },
    }),
  );
}
function VCFWrap(b) {
  return vcf(b, 1, 11);
}
let crossChecks = 0;
for (const p of reports) {
  const b = mk(p.black, p.white);
  if (p.black.length !== p.white.length)
    throw Error("illegal black-to-move count");
  const replay = new Uint8Array(225);
  for (let k = 0; k < p.black.length; k++)
    for (const [c, s] of [
      [1, p.black[k]],
      [2, p.white[k]],
    ]) {
      if (won(replay, 1) || won(replay, 2))
        throw Error("history after terminal");
      if (replay[parse(s)]) throw Error("occupied history");
      replay[parse(s)] = c;
    }
  if (appWinner(b) !== 0) throw Error("terminal start");
  b[parse(p.first)] = 1;
  for (const r of p.allReplies.branches) {
    b[parse(r.reply)] = 2;
    for (const c of [1, 2])
      if (JSON.stringify(wins(b, c)) !== JSON.stringify(appWinningMoves(b, c)))
        throw Error("win generator mismatch");
    const app = proveVCF(b, 1, { maxPly: 11, maxNodes: 100000 });
    if (!r.proven || !app.proven)
      throw Error("certificate cross-check failed " + p.id + " " + r.reply);
    crossChecks++;
    b[parse(r.reply)] = 0;
  }
}
console.log(
  JSON.stringify({
    independentWindowCount: windows.length,
    allDefenderRepliesCrossCheckedWithApp: crossChecks,
    validBlackToMovePositions: reports.length,
  }),
);

export { mk, wins, won, vcf, allReplies, firstFours, labels, empties };
