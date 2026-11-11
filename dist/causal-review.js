import {
  coord,
  winningLine,
  winner,
  proveVCF,
  validateRecord,
} from "./game.js";

const SIZE = 225;
const DIRECTIONS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];
const NAMES = ["横", "縦", "斜め", "斜め"];
const COLOR = ["", "黒", "白"];
const PROOF_LIMIT = { maxPly: 7, maxNodes: 450 };
const WINDOWS = { 5: [], 6: [] };
for (const length of [5, 6]) {
  for (let y = 0; y < 15; y++)
    for (let x = 0; x < 15; x++) {
      DIRECTIONS.forEach(([dx, dy], direction) => {
        const ex = x + (length - 1) * dx,
          ey = y + (length - 1) * dy;
        if (ex < 0 || ex >= 15 || ey < 0 || ey >= 15) return;
        WINDOWS[length].push({
          cells: Array.from(
            { length },
            (_, k) => (y + k * dy) * 15 + x + k * dx,
          ),
          direction,
        });
      });
    }
}

function boardCopy(input) {
  if (
    !input ||
    input.length !== SIZE ||
    Array.from(input).some((v) => ![0, 1, 2].includes(v))
  ) {
    throw new Error("盤面が不正です");
  }
  return Uint8Array.from(input);
}
const legal = (b, i) => Number.isInteger(i) && i >= 0 && i < SIZE && b[i] === 0;
const validPoint = (i) => Number.isInteger(i) && i >= 0 && i < SIZE;
const unique = (items) => [...new Set(items)];
const emptyPoints = (b) =>
  Array.from({ length: SIZE }, (_, i) => i).filter((i) => !b[i]);
function checkColor(c) {
  if (c !== 1 && c !== 2) throw new Error("手番が不正です");
}

// >=5 is equivalent to occupying at least one contiguous length-five window.
function winPoints(b, c) {
  const result = new Set();
  for (const { cells } of WINDOWS[5]) {
    let own = 0,
      empty = -1,
      blocked = false;
    for (const i of cells) {
      if (b[i] === 3 - c) {
        blocked = true;
        break;
      }
      if (b[i] === c) own++;
      else empty = i;
    }
    if (!blocked && own === 4) result.add(empty);
  }
  return [...result].sort((a, z) => a - z);
}

function patterns(b, c) {
  const found = new Map();
  const add = (kind, cells, points, direction, ends = []) => {
    const sorted = [...cells].sort((a, z) => a - z);
    const key = `${kind}:${sorted.join(",")}`;
    const old = found.get(key);
    if (old) {
      old.points = unique([...old.points, ...points]);
      old.ends = unique([...old.ends, ...ends]);
    } else
      found.set(key, {
        kind,
        color: c,
        cells: sorted,
        points: [...points],
        direction,
        ends: [...ends],
      });
  };
  for (const { cells, direction } of WINDOWS[5]) {
    if (cells.some((i) => b[i] === 3 - c)) continue;
    const own = cells.filter((i) => b[i] === c),
      spaces = cells.filter((i) => !b[i]);
    if (own.length === 4) add("four", own, spaces, direction);
    else if (own.length === 2) add("connection", own, spaces, direction);
  }
  for (const { cells, direction } of WINDOWS[6]) {
    if (b[cells[0]] || b[cells[5]]) continue;
    const middle = cells.slice(1, 5);
    if (middle.some((i) => b[i] === 3 - c)) continue;
    const own = middle.filter((i) => b[i] === c),
      spaces = middle.filter((i) => !b[i]);
    if (own.length === 3)
      add("three", own, spaces, direction, [cells[0], cells[5]]);
  }
  return [...found.values()];
}

function factsFor(b) {
  return {
    terminal: winner(b),
    immediateWins: { black: winPoints(b, 1), white: winPoints(b, 2) },
    patterns: [...patterns(b, 1), ...patterns(b, 2)],
  };
}

function supportFor(b, c, points) {
  const wanted = new Set(points);
  return unique(
    patterns(b, c)
      .filter((p) => p.kind === "four" && p.points.some((i) => wanted.has(i)))
      .flatMap((p) => p.cells),
  );
}

function frame(
  input,
  {
    last = null,
    title = "",
    text = "",
    focusColor = 1,
    extra = [],
    claims = [],
  } = {},
) {
  const b = Array.from(input),
    facts = factsFor(b),
    highlights = [];
  for (const c of [1, 2]) {
    const points = facts.immediateWins[c === 1 ? "black" : "white"];
    if (points.length)
      highlights.push({
        cells: supportFor(b, c, points),
        points,
        tone: c === focusColor ? "good" : "danger",
      });
  }
  if (last !== null && b[last]) {
    const line = winningLine(b, last);
    if (line.length)
      highlights.push({
        cells: line,
        points: [],
        tone: b[last] === focusColor ? "good" : "danger",
      });
    else if (!highlights.length) {
      const near = facts.patterns.filter((p) => p.cells.includes(last));
      const selected =
        near.find((p) => p.kind === "three") ||
        near.find((p) => p.kind === "connection");
      if (selected)
        highlights.push({
          cells: selected.cells,
          points: selected.points,
          tone: "focus",
        });
      else highlights.push({ cells: [last], points: [], tone: "focus" });
    }
  }
  for (const h of extra)
    highlights.push({
      cells: unique(h.cells || []).filter((i) => validPoint(i) && b[i] !== 0),
      points: unique(h.points || []).filter((i) => validPoint(i) && b[i] === 0),
      tone: h.tone || "focus",
    });
  return { board: b, last, title, text, highlights, facts, claims };
}

export function describePosition(input, color = 1, { last = null } = {}) {
  checkColor(color);
  const b = boardCopy(input),
    facts = factsFor(b);
  let title = `${COLOR[color]}番`,
    text = "";
  if (facts.terminal) {
    title = `${COLOR[facts.terminal]}の五`;
    text = "5個以上が完成";
  } else {
    const own = facts.immediateWins[color === 1 ? "black" : "white"];
    const other = facts.immediateWins[color === 1 ? "white" : "black"];
    if (own.length) {
      title = "五の完成点";
      text = `${COLOR[color]} ${own.map(coord).join("・")}`;
    } else if (other.length) {
      title = other.length > 1 ? "完成点が二つ以上" : "相手の五を止める";
      text = `${COLOR[3 - color]} ${other.map(coord).join("・")}`;
    } else {
      const near = facts.patterns.filter(
        (p) => last === null || p.cells.includes(last),
      );
      const three = near.find((p) => p.kind === "three");
      const connection = near.find((p) => p.kind === "connection");
      if (three) {
        title = `${COLOR[three.color]}の三`;
        text = `${three.points.map(coord).join("・")}で達四`;
      } else if (connection) {
        title = `${COLOR[connection.color]}の接続`;
        text = `${NAMES[connection.direction]}の同じ線に2石`;
      } else text = "五の完成点なし";
    }
  }
  return frame(b, {
    last: validPoint(last) && b[last] ? last : null,
    title,
    text,
    focusColor: color,
  });
}

export function describeMove(input, point, color = 1) {
  checkColor(color);
  const b = boardCopy(input);
  if (!legal(b, point) || winner(b)) throw new Error("着手できない点です");
  const before = describePosition(b, color);
  before.highlights.push({ cells: [], points: [point], tone: "focus" });
  b[point] = color;
  const after = describePosition(b, 3 - color, { last: point });
  after.title = `${COLOR[color]} ${coord(point)}`;
  // Describe the actor's new shape, rather than attributing an intention.
  if (winningLine(b, point).length) after.text = "五が完成";
  else {
    const wins = winPoints(b, color);
    const fresh = patterns(b, color).filter((p) => p.cells.includes(point));
    if (wins.length) after.text = `五の完成点 ${wins.map(coord).join("・")}`;
    else if (fresh.some((p) => p.kind === "three")) {
      after.text = `三の伸び先 ${unique(
        fresh.filter((p) => p.kind === "three").flatMap((p) => p.points),
      )
        .map(coord)
        .join("・")}`;
    } else if (fresh.some((p) => p.kind === "connection"))
      after.text = "同じ線の石につながる";
    else after.text = "五の完成点なし";
  }
  return [before, after];
}

function proof(input, c, limits = PROOF_LIMIT) {
  const result = proveVCF(input, c, limits);
  return result.proven
    ? {
        status: "proven",
        attacker: c,
        line: [...result.line],
        plies: result.plies,
        scope: "continuous-four",
        nodes: result.nodes,
      }
    : {
        status: "unknown",
        attacker: c,
        line: [],
        scope: "bounded-continuous-four",
        aborted: !!result.aborted,
        nodes: result.nodes,
      };
}

// Verifies the complete forcing policy represented by a VCF line, not merely
// the displayed defender's choices. Every omitted reply permits an immediate five.
function inspectCertificate(input, attacker, line) {
  const b = Uint8Array.from(input);
  const stopped = (reason, data = {}) => ({
    holds: false,
    reason,
    board: Array.from(b),
    ...data,
  });
  if (!line?.length || winner(b)) return stopped("unavailable");
  for (let k = 0; k < line.length; k += 2) {
    const m = line[k];
    if (!legal(b, m)) return stopped("occupied-attack", { point: m, step: k });
    b[m] = attacker;
    if (winningLine(b, m).length) return { holds: true };
    const counter = winPoints(b, 3 - attacker);
    if (counter.length)
      return stopped("counter-win", {
        point: m,
        step: k,
        counterPoints: counter,
      });
    const wins = winPoints(b, attacker);
    if (wins.length >= 2) return { holds: true };
    if (!wins.length) return stopped("no-four", { point: m, step: k });
    if (line[k + 1] !== wins[0] || !legal(b, line[k + 1]))
      return stopped("different-defense", { point: m, step: k, points: wins });
    b[line[k + 1]] = 3 - attacker;
    if (winningLine(b, line[k + 1]).length)
      return stopped("defender-win", { point: line[k + 1], step: k + 1 });
  }
  return stopped("incomplete");
}
const certificateHolds = (input, attacker, line) =>
  inspectCertificate(input, attacker, line).holds;

function proofForFirst(input, first, color, limits = PROOF_LIMIT) {
  const b = Uint8Array.from(input);
  if (!legal(b, first)) return null;
  b[first] = color;
  if (winningLine(b, first).length)
    return {
      status: "proven",
      attacker: color,
      line: [first],
      plies: 1,
      scope: "continuous-four",
    };
  if (winPoints(b, 3 - color).length) return null;
  const wins = winPoints(b, color);
  if (wins.length >= 2)
    return {
      status: "proven",
      attacker: color,
      line: [first, wins[0], wins[1]],
      plies: 3,
      scope: "continuous-four",
    };
  if (wins.length !== 1) return null;
  b[wins[0]] = 3 - color;
  const child = proof(b, color, {
    ...limits,
    maxPly: Math.max(1, limits.maxPly - 2),
  });
  return child.status === "proven"
    ? {
        ...child,
        line: [first, wins[0], ...child.line],
        plies: child.plies + 2,
      }
    : null;
}

function proofFrames(input, evidence, { prefix = "", focusColor = 1 } = {}) {
  if (!evidence || evidence.status !== "proven") return [];
  const b = Uint8Array.from(input),
    result = [];
  for (let k = 0; k < evidence.line.length; k++) {
    const point = evidence.line[k],
      c = k % 2 ? 3 - evidence.attacker : evidence.attacker;
    if (!legal(b, point) || winner(b)) break;
    const beforeAttackWins = winPoints(b, evidence.attacker);
    b[point] = c;
    const wins = winPoints(b, c),
      remainingAttackWins = winPoints(b, evidence.attacker);
    let text;
    const claims = [];
    if (winningLine(b, point).length) {
      text = `${COLOR[c]}の石が5個以上つながり、ここで勝ちです。`;
      claims.push({ type: "completed-five", color: c, point });
    } else if (c !== evidence.attacker && remainingAttackWins.length) {
      text = `${COLOR[c]}は${coord(point)}を止めましたが、${COLOR[evidence.attacker]}の${remainingAttackWins.map(coord).join("・")}が残っています。次にそこへ置けば五が完成します。`;
      claims.push({
        type: "blocked-but-remains",
        color: evidence.attacker,
        blocked: point,
        points: remainingAttackWins,
        previousPoints: beforeAttackWins,
      });
    } else if (wins.length >= 2) {
      const open = patterns(b, c).some(
        (p) => p.kind === "four" && p.points.length >= 2,
      );
      text = open
        ? `${COLOR[c]}は両端が空いた四（達四）を作りました。${COLOR[3 - c]}が${coord(wins[0])}を止めても、${coord(wins[1])}で五が完成します。`
        : `${COLOR[c]}は${wins.map(coord).join("・")}に五の完成点を作りました。${COLOR[3 - c]}は一度に両方を止められません。`;
      claims.push({ type: "two-completions", color: c, points: wins });
    } else if (wins.length === 1) {
      text =
        c === evidence.attacker
          ? `${COLOR[c]}は次に${coord(wins[0])}で五を完成できます。${COLOR[3 - c]}はここを止める必要があります。`
          : `${COLOR[c]}の${coord(point)}は受けながら四も作る手です。${COLOR[3 - c]}は${coord(wins[0])}を止めないと、次に五が完成します。`;
      claims.push({ type: "must-block", color: c, points: wins });
    } else {
      text = `${COLOR[c]}は${coord(point)}を止めました。${COLOR[evidence.attacker]}の五の完成点は一度なくなりました。`;
      claims.push({
        type: "completion-removed",
        color: evidence.attacker,
        blocked: point,
        previousPoints: beforeAttackWins,
      });
    }
    result.push(
      frame(b, {
        last: point,
        title: `${prefix}${COLOR[c]} ${coord(point)}`,
        text,
        focusColor,
        claims,
      }),
    );
  }
  return result;
}

function alternativeAssessment(before, point, evidence, limits = PROOF_LIMIT) {
  const b = Uint8Array.from(before);
  if (!legal(b, point)) return { status: "illegal" };
  const own = proofForFirst(b, point, 1, limits);
  if (own)
    return {
      status: "accepted",
      scope: own.plies === 1 ? "immediate-win" : "forced-win",
      proof: own,
    };
  b[point] = 1;
  const obstruction = inspectCertificate(b, 2, evidence.line);
  if (obstruction.holds) return { status: "refuted", proof: evidence };
  const counter = proof(b, 2, limits);
  if (counter.status === "proven") return { status: "refuted", proof: counter };
  // This is a proof that this named sequence fails, not a proof that White has
  // no other winning strategy. Preserve that narrower scope in every consumer.
  if (
    !["occupied-attack", "counter-win", "no-four"].includes(obstruction.reason)
  )
    return { status: "unknown", checked: counter };
  return {
    status: "accepted",
    scope: "line-prevented",
    overall: "unknown",
    checked: counter,
    obstruction,
  };
}

function findAlternatives(before, actual, evidence, ownProof, limits) {
  const order = unique([
    ...(ownProof?.status === "proven" ? [ownProof.line[0]] : []),
    ...evidence.line,
    ...winPoints(before, 2),
    ...emptyPoints(before),
  ]);
  const details = [];
  for (const point of order) {
    if (point === actual || !legal(before, point)) continue;
    const next = Uint8Array.from(before);
    next[point] = 1;
    if (certificateHolds(next, 2, evidence.line)) continue;
    const verdict = alternativeAssessment(before, point, evidence, limits);
    if (verdict.status === "accepted")
      details.push({ move: point, ...verdict });
    if (details.length === 8) break;
  }
  return details;
}

function improvementFrames(before, detail, evidence = null) {
  if (detail.proof)
    return [
      frame(before, {
        title: "打ち直す前",
        text:
          detail.proof.plies === 1
            ? `黒${coord(detail.move)}なら、この一手で五が完成します。`
            : `黒${coord(detail.move)}で四を作ると、白の受けを強制して勝ちまで続けられます。`,
        extra: [{ points: [detail.move], tone: "good" }],
      }),
      ...proofFrames(before, detail.proof),
    ];
  const next = Uint8Array.from(before);
  next[detail.move] = 1;
  const obstruction =
    detail.obstruction ||
    (evidence && inspectCertificate(next, 2, evidence.line));
  const plannedIndex = evidence?.line?.indexOf(detail.move) ?? -1;
  let text,
    claims = [];
  if (plannedIndex >= 0 && plannedIndex % 2 === 0) {
    text = `白が${coord(detail.move)}で${plannedIndex === 0 ? "攻め始める" : "次の四を作る"}前に、黒がその点を取ります。白は予定の場所に置けなくなります。`;
    claims = [{ type: "occupied-plan-point", color: 1, point: detail.move }];
  } else if (plannedIndex >= 0) {
    text = `白の四を受ける予定の${coord(detail.move)}へ、先に黒を置きます。白がその線を五に伸ばす道をふさぎます。`;
    claims = [{ type: "occupied-plan-point", color: 1, point: detail.move }];
  } else if (obstruction?.reason === "counter-win") {
    text = `黒${coord(detail.move)}で反撃を用意します。白${coord(obstruction.point)}と予定どおり攻めると、黒${coord(obstruction.counterPoints[0])}で五が完成します。`;
  } else if (obstruction?.reason === "no-four") {
    text = `黒${coord(detail.move)}で白の線をふさぎます。白${coord(obstruction.point)}に置いても、五の完成点を作れなくなります。`;
  } else text = `黒${coord(detail.move)}で、白の予定した点を先にふさぎます。`;
  const result = [
    frame(before, {
      title: "打ち直す理由",
      text,
      extra: [{ points: [detail.move], tone: "good" }],
    }),
    frame(next, {
      last: detail.move,
      title: `黒 ${coord(detail.move)}`,
      text,
      claims,
    }),
  ];
  if (obstruction && ["counter-win", "no-four"].includes(obstruction.reason)) {
    const counter = obstruction.reason === "counter-win";
    result.push(
      frame(obstruction.board, {
        last: obstruction.point,
        title: `白が同じ手順なら ${coord(obstruction.point)}`,
        text: counter
          ? `白は黒の四を残しています。黒${coord(obstruction.counterPoints[0])}で五が完成するので、白はこの攻めを続けられません。`
          : `白${coord(obstruction.point)}に置いても、白の五の完成点はありません。黒はここで四を受ける必要がありません。`,
        claims: counter
          ? [
              {
                type: "must-block",
                color: 1,
                points: obstruction.counterPoints,
              },
            ]
          : [{ type: "no-completion", color: 2 }],
      }),
    );
  }
  return result;
}

function classifyMoment(before, actual, after, whiteProof, blackProof) {
  if (whiteProof.plies === 1)
    return {
      kind: "miss-block",
      title: "五の完成点を見逃した",
      text: `白は${coord(whiteProof.line[0])}に置けば五が完成します。黒${coord(actual)}では、その点が空いたままです。`,
      skillId: "priority",
    };
  if (blackProof?.status === "proven")
    return {
      kind: "lost-order",
      title: "四追いの順を逃した",
      text: `黒${coord(blackProof.line[0])}なら四で白の受けを強制し、勝ちまで続きます。実戦の黒${coord(actual)}には、白${coord(whiteProof.line[0])}から四追いが始まります。`,
      skillId: "order",
    };
  if (whiteProof.plies === 3) {
    const next = Uint8Array.from(after);
    next[whiteProof.line[0]] = 2;
    const open = patterns(next, 2).some(
      (p) => p.kind === "four" && p.points.length >= 2,
    );
    const wins = winPoints(next, 2);
    return {
      kind: "allowed-fork",
      title: open ? "達四を許した" : "四四を許した",
      text: open
        ? `白${coord(whiteProof.line[0])}で、両端が空いた四になります。黒が${coord(wins[0])}を止めても、${coord(wins[1])}で五が完成します。`
        : `白${coord(whiteProof.line[0])}で、${wins.map(coord).join("・")}が五の完成点になります。黒は一度に両方を止められません。`,
      skillId: "defense",
    };
  }
  const createdThree = patterns(after, 1).some(
    (p) => p.kind === "three" && p.cells.includes(actual),
  );
  const blackFour = winPoints(after, 1).length > 0;
  const next = Uint8Array.from(after);
  next[whiteProof.line[0]] = 2;
  if ((createdThree || blackFour) && winPoints(next, 2).length) {
    const point = winPoints(next, 2)[0];
    const blocksAndAttacks = winPoints(after, 1).includes(whiteProof.line[0]);
    return {
      kind: "allowed-counter",
      title: blackFour ? "受けが逆四になった" : "三に逆四を許した",
      text: blocksAndAttacks
        ? `白${coord(whiteProof.line[0])}は黒の五を止めながら、白の四も作ります。黒は${coord(point)}を守る必要があり、そこから白の四が続きます。`
        : `黒の三に対し、白${coord(whiteProof.line[0])}は先に四を作ります。黒は${coord(point)}を守る必要があり、そこから白の四が続きます。`,
      skillId: "counter",
    };
  }
  return {
    kind: "allowed-vcf",
    title: "白の四追いを許した",
    text: `黒${coord(actual)}の後は白${coord(whiteProof.line[0])}で四ができます。黒が完成点を受けても、白の次の四が残る手順です。`,
    skillId: "defense",
  };
}

function immediateWinMoment(before, actual, ply, wins) {
  const after = Uint8Array.from(before);
  after[actual] = 1;
  const details = wins.map((move) => ({
    move,
    status: "accepted",
    scope: "immediate-win",
    proof: {
      status: "proven",
      attacker: 1,
      line: [move],
      plies: 1,
      scope: "continuous-four",
    },
  }));
  return {
    id: `${ply}:miss-win`,
    ply,
    kind: "miss-win",
    title: "五を完成できた",
    text: `${wins.map(coord).join("・")}なら、この一手で五。`,
    skillId: "priority",
    before: Array.from(before),
    actual,
    alternatives: [...wins],
    frames: [
      frame(before, {
        title: "五の完成点",
        text: `黒${wins.map(coord).join("・")}なら、この一手で五が完成します。相手を守る前に勝てる局面です。`,
        extra: [{ points: wins, tone: "good" }],
      }),
      frame(after, {
        last: actual,
        title: `実戦 黒${coord(actual)}`,
        text: "この手では五にならない",
      }),
    ],
    improvementFrames: improvementFrames(before, details[0]),
    scope: "immediate-win",
    evidence: {
      status: "proven",
      kind: "missed-immediate-win",
      winningPoints: [...wins],
    },
    alternativeDetails: details,
  };
}

export async function scanRecord(
  record,
  { onProgress = () => {}, proofLimits = PROOF_LIMIT } = {},
) {
  const valid = validateRecord({
    ...record,
    moves: record.moves?.map((m) => (typeof m === "number" ? m : { ...m })),
  });
  const limits = {
    maxPly: proofLimits.maxPly ?? PROOF_LIMIT.maxPly,
    maxNodes: proofLimits.maxNodes ?? PROOF_LIMIT.maxNodes,
  };
  const b = new Uint8Array(SIZE),
    moments = [];
  const coverage = {
    total: valid.moves.length,
    scannedBlackMoves: 0,
    unknownPlies: [],
    unavoidablePlies: [],
    provenMoments: 0,
    complete: false,
    scope: "bounded-continuous-four-with-local-improvements",
    limits,
  };
  for (let j = 0; j < valid.moves.length; j++) {
    const actual = valid.moves[j].i,
      color = (j % 2) + 1,
      ply = j + 1;
    if (color === 1) {
      coverage.scannedBlackMoves++;
      const ownWins = winPoints(b, 1),
        danger = winPoints(b, 2);
      const next = Uint8Array.from(b);
      next[actual] = 1;
      if (winningLine(next, actual).length) {
        /* Terminal wins need no correction. */
      } else if (ownWins.length)
        moments.push(immediateWinMoment(b, actual, ply, ownWins));
      else if (danger.length >= 2) coverage.unavoidablePlies.push(ply);
      else {
        const whiteProof = proof(next, 2, limits);
        if (whiteProof.status === "proven") {
          const blackProof = proof(b, 1, limits);
          const details = findAlternatives(
            b,
            actual,
            whiteProof,
            blackProof,
            limits,
          );
          if (details.length) {
            const kind = classifyMoment(
              b,
              actual,
              next,
              whiteProof,
              blackProof,
            );
            const moment = {
              id: `${ply}:${kind.kind}`,
              ply,
              ...kind,
              before: Array.from(b),
              actual,
              alternatives: details.map((d) => d.move),
              alternativeDetails: details,
              frames: [
                frame(b, {
                  title: "実戦の前",
                  text: kind.text,
                  extra: [
                    { points: [actual], tone: "focus" },
                    { points: [whiteProof.line[0]], tone: "danger" },
                  ],
                }),
                frame(next, {
                  last: actual,
                  title: `実戦 黒${coord(actual)}`,
                  text: kind.text,
                }),
                ...proofFrames(next, whiteProof),
              ],
              improvementFrames: improvementFrames(b, details[0], whiteProof),
              scope: details[0].scope,
              evidence: whiteProof,
              priorWinningProof:
                blackProof.status === "proven" ? blackProof : null,
            };
            moments.push(moment);
          } else coverage.unknownPlies.push(ply);
        } else coverage.unknownPlies.push(ply);
      }
    }
    b[actual] = color;
    onProgress({
      done: ply,
      total: valid.moves.length,
      moments: moments.length,
    });
    // Yield to the worker event loop; this also makes direct async calls usable.
    if (j % 8 === 7) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  coverage.complete = true;
  coverage.provenMoments = moments.length;
  moments.coverage = coverage;
  return moments;
}

export function judgeReviewMove(moment, point) {
  const b = boardCopy(moment.before);
  if (!legal(b, point) || winner(b))
    return {
      status: "illegal",
      accepted: false,
      title: "空いている交点へ",
      text: "",
      scope: "unknown",
      frames: [],
    };
  if (moment.kind === "miss-win") {
    const next = Uint8Array.from(b);
    next[point] = 1;
    if (winningLine(next, point).length)
      return {
        status: point === moment.alternatives[0] ? "correct" : "alternative",
        accepted: true,
        title: "五が完成",
        text: "",
        scope: "immediate-win",
        frames: describeMove(b, point, 1),
      };
    return {
      status: "refuted",
      accepted: false,
      title: "五の完成点を探す",
      text: "この手では五にならない",
      scope: "immediate-win",
      frames: describeMove(b, point, 1),
    };
  }
  if (
    !moment.evidence ||
    moment.evidence.status !== "proven" ||
    !moment.evidence.line
  )
    return {
      status: "unknown",
      accepted: false,
      title: "この手は未確認",
      text: "",
      scope: "unknown",
      frames: describeMove(b, point, 1),
    };
  const result = alternativeAssessment(b, point, moment.evidence);
  if (result.status === "refuted") {
    const next = Uint8Array.from(b);
    next[point] = 1;
    return {
      status: "refuted",
      accepted: false,
      title: "白の勝ち筋が残る",
      text: `白${coord(result.proof.line[0])}から続く`,
      scope: "forced-win",
      frames: [
        ...describeMove(b, point, 1),
        ...proofFrames(next, result.proof),
      ],
    };
  }
  if (result.status === "accepted")
    return {
      status: point === moment.alternatives[0] ? "correct" : "alternative",
      accepted: true,
      title:
        result.scope === "line-prevented"
          ? "この勝ち筋を消した"
          : "勝ちまでつながる",
      text: "",
      scope: result.scope,
      frames: improvementFrames(b, { move: point, ...result }, moment.evidence),
    };
  return {
    status: "unknown",
    accepted: false,
    title: "この手は未確認",
    text: "",
    scope: "unknown",
    frames: describeMove(b, point, 1),
  };
}
