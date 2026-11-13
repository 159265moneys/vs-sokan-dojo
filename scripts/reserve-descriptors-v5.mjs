import {
  compileGoal,
  evaluateGoal,
  five,
  six,
  axes,
  wins,
  coord,
} from "./reserve-oracle-v5.mjs";
const names = (xs) => xs.map(coord).join("・"),
  axisNames = ["横", "縦", "右下がりの斜め", "右上がりの斜め"];
const unique = (xs) => [...new Set(xs)].sort((a, b) => a - b);
function connection(board, origin, supports) {
  return supports.map((s) => {
    const dx = (s % 15) - (origin % 15),
      dy = Math.floor(s / 15) - Math.floor(origin / 15),
      axis = axes.findIndex(([x, y]) => dx * y === dy * x),
      windows = five
        .filter(
          (w) =>
            w.axis === axis &&
            w.cells.includes(origin) &&
            w.cells.includes(s) &&
            w.cells.every((i) => board[i] !== 2),
        )
        .map((w) => w.cells);
    const step = axis < 0 ? null : [Math.sign(dx), Math.sign(dy)],
      between = [];
    if (step)
      for (let k = 1; k < Math.max(Math.abs(dx), Math.abs(dy)); k++) {
        const i =
          (Math.floor(origin / 15) + k * step[1]) * 15 +
          (origin % 15) +
          k * step[0];
        if (board[i] === 2) between.push(i);
      }
    const blocked = five
      .filter(
        (w) =>
          w.axis === axis && w.cells.includes(origin) && w.cells.includes(s),
      )
      .map((w) => ({
        cells: w.cells,
        blockers: w.cells.filter((i) => board[i] === 2),
      }))
      .filter((w) => w.blockers.length);
    const segment = [origin];
    if (axis >= 0) {
      const [sx, sy] = axes[axis];
      for (const sign of [-1, 1]) {
        for (let k = 1; k < 15; k++) {
          const x = (origin % 15) + sign * k * sx;
          const y = Math.floor(origin / 15) + sign * k * sy;
          if (x < 0 || x >= 15 || y < 0 || y >= 15 || board[y * 15 + x] === 2)
            break;
          if (sign < 0) segment.unshift(y * 15 + x);
          else segment.push(y * 15 + x);
        }
      }
    }
    return { support: s, axis, windows, between, blocked, segment };
  });
}

function fourExample(board, supports, followup) {
  const required = [...supports, followup.move];
  const window = followup.windows.find((cells) => {
    const locations = required.map((i) => cells.indexOf(i));
    return (
      locations.every((i) => i >= 0) &&
      Math.max(...locations) - Math.min(...locations) === 3
    );
  });
  if (!window) return { ...followup, four: [], outer: [], blockers: [] };
  const start = Math.min(...required.map((i) => window.indexOf(i)));
  const four = window.slice(start, start + 4);
  const dx = (four[1] % 15) - (four[0] % 15);
  const dy = Math.floor(four[1] / 15) - Math.floor(four[0] / 15);
  const outer = [
    [four[0], -1],
    [four.at(-1), 1],
  ].flatMap(([i, sign]) => {
    const x = (i % 15) + sign * dx,
      y = Math.floor(i / 15) + sign * dy;
    return x >= 0 && x < 15 && y >= 0 && y < 15 ? [y * 15 + x] : [];
  });
  return {
    ...followup,
    four,
    outer,
    blockers: outer.filter((i) => board[i] === 2),
  };
}

export function freshDescriptor(p, fact) {
  const pr = p.prediction,
    c = pr.candidate ?? pr.move,
    r = pr.reply,
    ex = p.nodes[0].choices[0].continuations?.[0],
    after = [...p.board];
  for (const m of ex?.moves || []) after[m.i] = m.side;
  if (p.unitId === "conditions") {
    const b = [...p.board];
    b[c] = 1;
    const windows = five.filter(
        (w) =>
          w.cells.includes(c) && w.cells.filter((i) => b[i] === 1).length === 4,
      ),
      blockers = unique(
        windows.flatMap((w) => w.cells.filter((i) => b[i] === 2)),
      );
    let boundary = null;
    for (let y = 0; y < 15; y++)
      for (let x = 0; x < 15; x++)
        for (const [dx, dy] of axes) {
          const cells = Array.from({ length: 4 }, (_, k) => [
            x + k * dx,
            y + k * dy,
          ]);
          if (
            !cells.every(
              ([xx, yy]) =>
                xx >= 0 &&
                xx < 15 &&
                yy >= 0 &&
                yy < 15 &&
                b[yy * 15 + xx] === 1,
            ) ||
            !cells.some(([xx, yy]) => yy * 15 + xx === c)
          )
            continue;
          for (const [k, sign] of [
            [0, -1],
            [3, 1],
          ]) {
            const [xx, yy] = cells[k],
              ox = xx + sign * dx,
              oy = yy + sign * dy;
            if (ox < 0 || ox >= 15 || oy < 0 || oy >= 15)
              boundary = {
                anchor: coord(yy * 15 + xx),
                outward: [sign * dx, sign * dy],
              };
          }
        }
    return {
      reason: {
        kind: "completion-count",
        move: c,
        completions: fact.finishes,
        windows: windows.map((w) => ({
          axis: w.axis,
          cells: w.cells,
          blockers: w.cells.filter((i) => b[i] === 2),
        })),
        blockers,
        boundary,
      },
      blockers,
      boundary,
      text: `黒${coord(c)}の後、${fact.finishes.length ? `完成点は${names(fact.finishes)}の${fact.finishes.length}か所` : "完成点はない"}。${blockers.length ? `白${names(blockers)}の点には完成できない。` : ""}`,
    };
  }
  if (p.unitId === "counter") {
    const b = [...p.board];
    b[c] = 1;
    const blackCompletions = wins(b, 1);
    b[r] = 2;
    const profiles = axes.map((_, axis) => {
      const sets = five
        .filter(
          (w) =>
            w.axis === axis &&
            w.cells.includes(r) &&
            w.cells.every((i) => b[i] !== 1),
        )
        .map((w) => w.cells.filter((i) => i !== r && b[i] === 2));
      const maximum = Math.max(0, ...sets.map((s) => s.length));
      return {
        axis,
        maximumSupport: maximum,
        supportSets: sets
          .filter((s) => s.length === maximum)
          .filter(
            (s, i, a) =>
              a.findIndex((t) => JSON.stringify(t) === JSON.stringify(s)) === i,
          ),
      };
    });
    const maximum = Math.max(
      ...profiles.map((profile) => profile.maximumSupport),
    );
    const profile = profiles.find((item) => item.maximumSupport === maximum);
    const supportExample = {
      axis: profile.axis,
      cells: unique([r, ...(profile.supportSets[0] || [])]),
    };
    return {
      reason: {
        kind: "counter-response",
        candidate: c,
        reply: r,
        blackCompletions,
        whiteCompletions: fact.finishes,
        supportProfiles: profiles,
        supportExample,
        accepted: fact.accepted,
      },
      text: fact.finishes.length
        ? `白${coord(r)}で受けると四になる。完成点は${names(fact.finishes)}の${fact.finishes.length}か所。`
        : `白${coord(r)}を含む、黒のない5点区間では、白${names(supportExample.cells)}の${1 + maximum}個が最大。四にはならず、白の完成点はない。`,
    };
  }
  if (p.unitId === "branch") {
    const plan = compileGoal(after, { objective: "four", cells: pr.support }),
      four = evaluateGoal(after, plan, { details: true }),
      followups = four.accepted.map((move) => ({
        move,
        completions: four.byMove[move].finishes,
        windows: four.byMove[move].windows,
      })),
      examples = followups.map((followup) =>
        fourExample(after, pr.support, followup),
      ),
      winningExamples = examples.filter((item) => item.completions.length >= 2),
      explanationCandidates = winningExamples.length
        ? winningExamples
        : examples,
      best =
        explanationCandidates.find((item) => item.four.length === 4) ||
        explanationCandidates[0],
      blockedWindows = [];
    for (const [move, v] of plan.plans)
      for (const w of v.witnesses) {
        const blockers = w.cells.filter((i) => after[i] === 2);
        if (blockers.length)
          blockedWindows.push({ move, cells: w.cells, blockers });
      }
    const blockers = unique(
      blockedWindows.flatMap((window) => window.blockers),
    );
    return {
      reason: {
        kind: "remaining-four",
        supports: pr.support,
        followups,
        example: best || null,
        blockedWindows,
        accepted: fact.accepted,
      },
      text: best
        ? `黒${coord(best.move)}で${best.four.length ? `${names(best.four)}の連続した` : ""}四。完成点は${names(best.completions)}の${best.completions.length}か所。${fact.outcome === "no" ? `${best.blockers.length ? `外側の白${names(best.blockers)}で反対側が閉じる。` : ""}指定の黒石から次の一手で完成点を2つにはできない。` : ""}`
        : `${blockers.length ? `白${names(blockers)}が必要な5点区間を塞ぎ、` : ""}指定の黒石から四を作れない。`,
    };
  }
  if (p.unitId === "prepare") {
    const plan = compileGoal(after, { objective: "open-three", cells: [c] }),
      result = evaluateGoal(after, plan, { details: true }),
      followups = result.accepted.map((move) => ({
        move,
        axes: result.byMove[move].axes,
        windows: result.byMove[move].windows,
      })),
      blockedWindows = [];
    for (const [move, v] of plan.plans)
      for (const w of v.witnesses) {
        const blockers = w.cells.filter((i) => after[i] === 2);
        if (blockers.length)
          blockedWindows.push({ move, axis: w.axis, cells: w.cells, blockers });
      }
    const availableText = fact.directions
      .map(
        (axis) =>
          `${axisNames[axis]}は黒${names(followups.filter((item) => item.axes.includes(axis)).map((item) => item.move))}で、黒${coord(c)}を使う活三を作れる。`,
      )
      .join("");
    const blockedAxes = unique(
      blockedWindows.map((window) => window.axis),
    ).filter((axis) => !fact.directions.includes(axis));
    const blockedText = blockedAxes
      .map(
        (axis) =>
          `${axisNames[axis]}は白${names(unique(blockedWindows.filter((window) => window.axis === axis).flatMap((window) => window.blockers)))}が必要な6点区間を塞ぐ。`,
      )
      .join("");
    const supportAxes = pr.support.map((support) => {
      const dx = (support % 15) - (c % 15),
        dy = Math.floor(support / 15) - Math.floor(c / 15);
      return axes.findIndex(([x, y]) => dx * y === dy * x);
    });
    const sameAxisText =
      supportAxes.length >= 2 &&
      supportAxes[0] >= 0 &&
      supportAxes.every((axis) => axis === supportAxes[0])
        ? "同じ軸の反対向きは1方向として数える。"
        : "";
    return {
      reason: {
        kind: "followup-directions",
        supports: pr.support,
        origin: c,
        directions: fact.directions,
        followups,
        blockedWindows,
      },
      text: availableText + blockedText + sameAxisText,
    };
  }
  if (p.unitId === "opening") {
    const arms = connection(after, c, pr.support);
    return {
      reason: { kind: "connection", origin: c, arms, accepted: fact.accepted },
      text: arms
        .map((a) =>
          a.windows.length
            ? `黒${coord(c)}から${coord(a.support)}へ${axisNames[a.axis]}の5点がつながる。`
            : a.between.length
              ? `${coord(c)}から${coord(a.support)}の間は白${names(a.between)}で切れる。`
              : `白${names(unique(a.blocked.flatMap((window) => window.blockers)))}に区切られ、${axisNames[a.axis]}は${coord(a.segment[0])}〜${coord(a.segment.at(-1))}の${a.segment.length}点。${coord(a.support)}へつなぐ5点の余地がない。`,
        )
        .join(""),
    };
  }
  const threats = (fact.whiteForks || []).map((move) => {
      const b = [...after];
      b[move] = 2;
      return { move, completions: wins(b, 2) };
    }),
    reason = {
      kind: "priority",
      blackCompletions: fact.blackWins,
      whiteCompletions: fact.whiteWins,
      whiteForks: threats,
      accepted: fact.accepted,
    };
  if (fact.outcome === "build") {
    const move = fact.accepted[0],
      b = [...after];
    b[move] = 1;
    reason.example = { move, arms: connection(b, move, ex.cells) };
  }
  return {
    reason,
    text:
      fact.outcome === "win"
        ? `黒${names(fact.blackWins)}で五連。${fact.whiteWins.length ? `白にも${names(fact.whiteWins)}の完成点があるが、` : ""}黒が先に完成して終わる。`
        : fact.outcome === "defense"
          ? (fact.whiteWins.length
              ? `白の完成点は${names(fact.whiteWins)}。`
              : threats
                  .map(
                    (t) =>
                      `白${coord(t.move)}で${names(t.completions)}が完成点になる。`,
                  )
                  .join("")) +
            `黒${names(fact.accepted)}で、白の即五連と次の二重攻撃を消せる。`
          : `双方の即五連と白の次の二完成点はない。黒${coord(fact.accepted[0])}で指定した二石へつながる。`,
  };
}
