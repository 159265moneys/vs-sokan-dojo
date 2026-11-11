import { coord, winningLine, winner, proveVCF } from "./game.js";

const dirs = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];
const segments = { 5: [], 6: [] };
for (const size of [5, 6])
  for (let y = 0; y < 15; y++)
    for (let x = 0; x < 15; x++)
      dirs.forEach(([dx, dy], axis) => {
        const ex = x + (size - 1) * dx,
          ey = y + (size - 1) * dy;
        if (ex < 0 || ex > 14 || ey < 0 || ey > 14) return;
        segments[size].push({
          axis,
          cells: Array.from(
            { length: size },
            (_, k) => (y + k * dy) * 15 + x + k * dx,
          ),
        });
      });
const uniq = (a) => [...new Set(a)];
const copy = (b) => Uint8Array.from(b);
export function completionPoints(b, color) {
  const out = new Set();
  for (const { cells } of segments[5]) {
    if (cells.some((i) => b[i] === 3 - color)) continue;
    if (cells.filter((i) => b[i] === color).length === 4)
      out.add(cells.find((i) => !b[i]));
  }
  return [...out].sort((a, b) => a - b);
}
export function lineShapes(b, color) {
  const groups = new Map();
  function add(kind, cells, points, axis, required = []) {
    const key = kind + ":" + axis + ":" + cells.join(",");
    if (groups.has(key)) {
      const g = groups.get(key);
      g.points = uniq([...g.points, ...points]);
      g.required = uniq([...g.required, ...required]);
    } else groups.set(key, { kind, cells, points, axis, required });
  }
  for (const { cells, axis } of segments[5]) {
    if (cells.some((i) => b[i] === 3 - color)) continue;
    const own = cells.filter((i) => b[i] === color);
    if (own.length === 4)
      add(
        "four",
        own,
        cells.filter((i) => !b[i]),
        axis,
      );
  }
  for (const { cells, axis } of segments[6]) {
    if (b[cells[0]] || b[cells[5]]) continue;
    const middle = cells.slice(1, 5);
    if (middle.some((i) => b[i] === 3 - color)) continue;
    const own = middle.filter((i) => b[i] === color),
      gaps = middle.filter((i) => !b[i]);
    if (own.length === 3)
      add("three", own, gaps, axis, [cells[0], cells[5], ...gaps]);
  }
  return [...groups.values()];
}
const catalog = {
  "open-three": {
    name: "活三",
    skillId: "conditions",
    rank: 20,
    lesson: "両端の空いた四へ伸びる三。四になる前に止める。",
  },
  "broken-three": {
    name: "飛び三",
    skillId: "conditions",
    rank: 25,
    lesson: "間の空点を埋めると両端の四になる。外側だけを見ない。",
  },
  four: {
    name: "四",
    skillId: "priority",
    rank: 30,
    lesson: "次に五を作れる。相手は勝ち口を守る必要がある。",
  },
  "broken-four": {
    name: "飛び四",
    skillId: "priority",
    rank: 35,
    lesson: "離れていても、間の一点で五になる。",
  },
  "open-four": {
    name: "両端の四",
    skillId: "conditions",
    rank: 70,
    lesson: "二つの勝ち口があり、一手では両方を止められない。",
  },
  "double-three": {
    name: "三三",
    skillId: "branch",
    rank: 65,
    lesson:
      "一方を止められたら、もう一方から四を作る。相手の四による反撃も確認する。",
  },
  "four-three": {
    name: "四三",
    skillId: "order",
    rank: 80,
    lesson:
      "四を受けさせた後、残った三を使う。受け四で反撃されないか確認する。",
  },
  "double-four": {
    name: "四四",
    skillId: "order",
    rank: 90,
    lesson: "二方向に別々の勝ち口を作る。相手の即勝ちがなければ受け切れない。",
  },
  "counter-four": {
    name: "受け四",
    skillId: "counter",
    rank: 100,
    lesson: "守る一石で自分の四も作り、相手に守らせる。",
  },
  "reverse-four": {
    name: "逆四",
    skillId: "counter",
    rank: 60,
    lesson: "相手の三に、四で反撃する。先に相手へ受けを迫る。",
  },
  "double-plan": {
    name: "両フクミ",
    skillId: "prepare",
    rank: 88,
    lesson:
      "すぐ三を作らず、二つの四追いを準備する。相手が片方を止めたら、残る攻めを使う。",
  },
  "four-chase": {
    name: "四追い",
    skillId: "order",
    rank: 85,
    lesson: "四で相手の受けを強制し、次の方向へつないで勝つ。",
  },
};
function contiguous(cells, axis) {
  const step = dirs[axis][1] * 15 + dirs[axis][0];
  return cells.every((i, j) => j === 0 || i - cells[j - 1] === step);
}
function motif(type, color, groups, { pivot = null } = {}) {
  const info = catalog[type],
    cells = uniq(groups.flatMap((g) => g.cells)),
    points = uniq(groups.flatMap((g) => g.points));
  const who = color === 1 ? "黒" : "白";
  let text = info.lesson;
  if (type === "open-three" || type === "broken-three")
    text = `${cells.map(coord).join("・")}が${info.name}。${points.map(coord).join("・")}で両端の四になる。`;
  if (type === "four-three") {
    const four = groups.find((g) => g.kind === "four"),
      three = groups.find((g) => g.kind === "three");
    text = `${who}は${four.points.map(coord).join("・")}で五を狙い、同時に別方向の三を残している。${color === 1 ? "白が四を受けた後は" : "四を受けても"}、${three.cells.map(coord).join("・")}の三${color === 1 ? "を使って攻めを続ける" : "から次の攻めが続く"}。`;
  }
  if (type === "double-three")
    text = `${who}の三が二方向で交わっている。片方だけを止めても、もう片方から両端の四を狙える。四による反撃があるかは別に確かめる。`;
  return {
    id:
      type +
      ":" +
      color +
      ":" +
      cells
        .slice()
        .sort((a, b) => a - b)
        .join(","),
    type,
    color,
    ...info,
    cells,
    points,
    groups: groups.map((g) => ({ ...g })),
    pivot,
    text,
    confirmedWin: false,
  };
}
export function recognizePatterns(
  input,
  { last = null, before = null, sideToMove = 1 } = {},
) {
  const b = copy(input);
  if (winner(b)) return [];
  const result = [];
  for (const color of [1, 2]) {
    const shapes = lineShapes(b, color),
      fours = shapes.filter((g) => g.kind === "four"),
      threes = shapes.filter((g) => g.kind === "three");
    const compound = [];
    for (let i = 0; i < shapes.length; i++)
      for (let j = i + 1; j < shapes.length; j++) {
        const a = shapes[i],
          z = shapes[j],
          shared = a.cells.filter((p) => z.cells.includes(p));
        if (a.axis === z.axis || !shared.length) continue;
        let type = null;
        if (
          a.kind === "four" &&
          z.kind === "four" &&
          uniq([...a.points, ...z.points]).length >= 2
        )
          type = "double-four";
        else if (
          a.kind !== z.kind &&
          (a.kind === "four" ? a : z).points.length === 1
        )
          type = "four-three";
        else if (a.kind === "three") type = "double-three";
        if (type)
          compound.push(motif(type, color, [a, z], { pivot: shared[0] }));
      }
    result.push(...compound);
    for (const shape of shapes) {
      if (
        compound.some((m) =>
          m.groups.some(
            (g) =>
              g.axis === shape.axis &&
              g.cells.join(",") === shape.cells.join(","),
          ),
        )
      )
        continue;
      const type =
        shape.kind === "four"
          ? shape.points.length >= 2
            ? "open-four"
            : contiguous(shape.cells, shape.axis)
              ? "four"
              : "broken-four"
          : contiguous(shape.cells, shape.axis)
            ? "open-three"
            : "broken-three";
      result.push(motif(type, color, [shape]));
    }
    if (
      before &&
      last !== null &&
      b[last] === color &&
      completionPoints(b, color).length === 1 &&
      fours.some((g) => g.cells.includes(last))
    ) {
      const stopped = completionPoints(before, 3 - color).includes(last);
      const enemyThrees = lineShapes(before, 3 - color).some(
        (g) => g.kind === "three",
      );
      if (stopped || enemyThrees) {
        const type = stopped ? "counter-four" : "reverse-four",
          m = motif(
            type,
            color,
            fours.filter((g) => g.cells.includes(last)),
            { pivot: last },
          );
        m.text = stopped
          ? `${who(color)}${coord(last)}で相手の五を防ぎ、同時に${m.points.map(coord).join("・")}を勝ち口にする四を作った。相手は攻めを続ける前に受ける必要がある。`
          : `${who(color)}${coord(last)}の四で、相手の三に反撃した。${m.points.map(coord).join("・")}を放置すると五になる。`;
        result.push(m);
      }
    }
  }
  for (const m of result) {
    const opponentWins = completionPoints(b, 3 - m.color);
    m.urgent = opponentWins.length === 0;
    m.caution = opponentWins.length
      ? `${who(3 - m.color)}には${opponentWins.map(coord).join("・")}で先に五を作る手がある。形だけで勝ちとは判断できない。`
      : "";
    if (m.type === "four-three" && !opponentWins.length) {
      const reply = m.groups.find((g) => g.kind === "four").points[0],
        next = copy(b);
      if (!next[reply]) {
        next[reply] = 3 - m.color;
        const counter = completionPoints(next, 3 - m.color);
        if (counter.length && !completionPoints(next, m.color).length)
          m.caution = `${who(3 - m.color)}が${coord(reply)}を受けると、${counter.map(coord).join("・")}を狙う四もできる。三を伸ばす前に、この反撃への対応が必要。`;
      }
    }
    if (["open-four", "double-four"].includes(m.type))
      m.confirmedWin =
        !opponentWins.length &&
        (sideToMove === m.color || completionPoints(b, m.color).length >= 2);
  }
  const selected = result.filter(
    (p) =>
      !["four", "broken-four"].includes(p.type) ||
      !result.some(
        (q) =>
          q.color === p.color &&
          ["counter-four", "reverse-four"].includes(q.type) &&
          p.cells.every((i) => q.cells.includes(i)),
      ),
  );
  return selected.sort(
    (a, z) =>
      z.rank - a.rank ||
      (z.color === sideToMove ? 1 : 0) - (a.color === sideToMove ? 1 : 0),
  );
}
const who = (c) => (c === 1 ? "黒" : "白");
export function patternHighlights(pattern, board) {
  if (!pattern) return [];
  const lines = pattern.groups
    .map((g) => g.cells.filter((i) => board[i] === pattern.color))
    .filter((a) => a.length >= 2);
  return [
    {
      cells: pattern.cells.filter((i) => board[i] === pattern.color),
      points: pattern.points.filter((i) => !board[i]),
      tone: pattern.color === 1 ? "good" : "danger",
      motif: true,
      lines,
      patternId: pattern.id,
      critical: pattern.projected ? pattern.points[0] : null,
    },
  ];
}
export function provePatternMove(
  input,
  color,
  point,
  { maxPly = 7, maxNodes = 450, allowQuiet = false } = {},
) {
  const b = copy(input);
  if (b[point] || winner(b)) return null;
  b[point] = color;
  if (winningLine(b, point).length)
    return {
      status: "proven",
      attacker: color,
      line: [point],
      plies: 1,
      scope: "immediate-win",
    };
  if (completionPoints(b, 3 - color).length) return null;
  const wins = completionPoints(b, color);
  if (wins.length >= 2)
    return {
      status: "proven",
      attacker: color,
      line: [point, wins[0], wins[1]],
      plies: 3,
      scope: "continuous-four",
    };
  if (wins.length === 1) {
    b[wins[0]] = 3 - color;
    const proof = proveVCF(b, color, { maxPly: maxPly - 2, maxNodes });
    return proof.proven
      ? {
          ...proof,
          status: "proven",
          attacker: color,
          line: [point, wins[0], ...proof.line],
          plies: proof.plies + 2,
        }
      : null;
  }
  if (!allowQuiet) return null;
  // A three is not a win certificate. Verify every legal defensive reply.
  let representative = null,
    branches = 0;
  const plans = [];
  const defensivePoints = new Set(
    lineShapes(b, color)
      .filter((g) => g.kind === "three")
      .flatMap((g) => g.points),
  );
  for (let reply = 0; reply < 225; reply++)
    if (!b[reply]) {
      b[reply] = 3 - color;
      if (winningLine(b, reply).length) {
        b[reply] = 0;
        return null;
      }
      const proof = proveVCF(b, color, { maxPly: maxPly - 2, maxNodes });
      b[reply] = 0;
      if (!proof.proven) return null;
      branches++;
      if (!plans.some((p) => p.line[0] === proof.line[0]))
        plans.push({ reply, line: proof.line });
      if (
        !representative ||
        proof.plies > representative.plies ||
        (proof.plies === representative.plies &&
          defensivePoints.has(reply) &&
          !defensivePoints.has(representative.reply))
      )
        representative = { ...proof, reply };
    }
  return representative
    ? {
        status: "proven",
        attacker: color,
        line: [point, representative.reply, ...representative.line],
        plies: representative.plies + 2,
        scope: "all-replies-then-vcf",
        branches,
        plans,
      }
    : null;
}
export function patternOpportunities(
  input,
  color,
  { maxQuietChecks = 2, ...limits } = {},
) {
  const b = copy(input);
  if (winner(b)) return [];
  const candidates = new Set();
  // Only points belonging to real threat construction windows; no two-stone glow.
  for (const { cells } of segments[5])
    if (
      !cells.some((i) => b[i] === 3 - color) &&
      cells.filter((i) => b[i] === color).length >= 2
    )
      for (const i of cells) if (!b[i]) candidates.add(i);
  const possibilities = [];
  for (const i of candidates) {
    b[i] = color;
    let shapes = recognizePatterns(b, {
      last: i,
      sideToMove: 3 - color,
    }).filter(
      (m) =>
        m.cells.includes(i) &&
        ["open-four", "double-four", "four-three", "double-three"].includes(
          m.type,
        ),
    );
    if (
      !shapes.length &&
      !lineShapes(b, color).some((g) => g.cells.includes(i))
    ) {
      const groups = [];
      for (const { cells, axis } of segments[5])
        if (
          cells.includes(i) &&
          !cells.some((p) => b[p] === 3 - color) &&
          cells.filter((p) => b[p] === color).length === 3 &&
          !groups.some((g) => g.axis === axis)
        )
          groups.push({
            kind: "preparation",
            axis,
            cells: cells.filter((p) => b[p] === color),
            points: [],
          });
      if (groups.length >= 2)
        shapes = [motif("double-plan", color, groups, { pivot: i })];
    }
    b[i] = 0;
    if (shapes.length) possibilities.push({ move: i, pattern: shapes[0] });
  }
  possibilities.sort(
    (a, z) =>
      z.pattern.groups.length - a.pattern.groups.length ||
      z.pattern.cells.length - a.pattern.cells.length ||
      z.pattern.rank - a.pattern.rank,
  );
  const found = [];
  let quietChecks = 0;
  for (const item of possibilities) {
    const quiet = ["double-three", "double-plan"].includes(item.pattern.type);
    if (quiet && quietChecks >= maxQuietChecks) continue;
    if (quiet) quietChecks++;
    const proof = provePatternMove(b, color, item.move, {
      ...limits,
      allowQuiet: quiet,
    });
    if (proof) {
      item.pattern.confirmedWin = true;
      found.push({ ...item, proof });
    }
  }
  return found.sort(
    (a, z) => z.pattern.rank - a.pattern.rank || a.proof.plies - z.proof.plies,
  );
}
export function sequencePattern(input, evidence) {
  if (!evidence?.line || evidence.line.length < 5) return null;
  const b = copy(input),
    groups = [];
  evidence.line.forEach((i, k) => {
    if (b[i]) return;
    const side = k % 2 ? 3 - evidence.attacker : evidence.attacker;
    b[i] = side;
    if (side === evidence.attacker)
      groups.push(
        ...lineShapes(b, side).filter(
          (g) => g.kind === "four" && g.cells.includes(i),
        ),
      );
  });
  if (groups.length < 2) return null;
  const m = motif("four-chase", evidence.attacker, groups);
  m.cells = m.cells.filter((i) => input[i] === evidence.attacker);
  m.points = uniq(evidence.line.filter((_, k) => k % 2 === 0)).filter(
    (i) => !input[i],
  );
  m.confirmedWin = true;
  m.text = `${m.points.map(coord).join("→")}と四をつなぐ勝ち筋。相手の受ける位置を利用して、攻める方向を切り替える。`;
  return m;
}
