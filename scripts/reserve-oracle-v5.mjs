// Independent finite oracle for reserve generation and tests.
// This module deliberately imports no production game or learning predicate.
// Missing bounded search results are never interpreted as losses.
export const axes = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ],
  five = [],
  six = [];
for (let y = 0; y < 15; y++)
  for (let x = 0; x < 15; x++)
    for (let a = 0; a < 4; a++) {
      const [dx, dy] = axes[a];
      for (const n of [5, 6])
        if (
          x + (n - 1) * dx >= 0 &&
          x + (n - 1) * dx < 15 &&
          y + (n - 1) * dy >= 0 &&
          y + (n - 1) * dy < 15
        )
          (n === 5 ? five : six).push({
            axis: a,
            cells: Array.from(
              { length: n },
              (_, k) => (y + k * dy) * 15 + x + k * dx,
            ),
          });
    }
export const empty = (b) => b.flatMap((s, i) => (s ? [] : [i]));
export const coord = (i) =>
  "ABCDEFGHIJKLMNO"[i % 15] + (15 - Math.floor(i / 15));
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function won(b, s) {
  return five.some((w) => w.cells.every((i) => b[i] === s));
}
export function wins(b, s) {
  const out = new Set();
  for (const { cells } of five) {
    let own = 0,
      gap = -1,
      bad = false;
    for (const i of cells) {
      if (b[i] === s) own++;
      else if (b[i]) {
        bad = true;
        break;
      } else gap = i;
    }
    if (!bad && own === 4) out.add(gap);
  }
  return [...out].sort((a, b) => a - b);
}
export function forks(b, s) {
  const cand = new Set();
  for (const { cells } of five) {
    let own = 0,
      bad = false;
    for (const i of cells) {
      if (b[i] === s) own++;
      else if (b[i]) {
        bad = true;
        break;
      }
    }
    if (!bad && own === 3) for (const i of cells) if (!b[i]) cand.add(i);
  }
  return [...cand]
    .filter((i) => {
      b[i] = s;
      const ok = !won(b, s) && wins(b, s).length >= 2 && !wins(b, 3 - s).length;
      b[i] = 0;
      return ok;
    })
    .sort((a, b) => a - b);
}
export function fingerprint(b) {
  return rolesFingerprint(Array.from(b).flatMap((s, i) => (s ? [[i, s]] : [])));
}
export function rolesFingerprint(items) {
  if (!items.length) return "empty";
  return Array.from({ length: 8 }, (_, t) => {
    const a = items.map(([i, s]) => {
      let x = i % 15,
        y = Math.floor(i / 15);
      if (t & 4) [x, y] = [y, x];
      return [t & 1 ? -x : x, t & 2 ? -y : y, s];
    });
    const x = Math.min(...a.map((p) => p[0])),
      y = Math.min(...a.map((p) => p[1]));
    return a
      .map(([xx, yy, s]) => [xx - x, yy - y, s].join(","))
      .sort()
      .join(";");
  }).sort()[0];
}
export function compileGoal(base, ex) {
  const b = base.map((s) => (s === 1 ? 1 : 0)),
    plans = new Map(),
    specified = ex.cells || [];
  for (let i = 0; i < 225; i++)
    if (!b[i]) {
      b[i] = 1;
      const all = [...specified, i],
        win = five
          .filter(
            (w) => w.cells.includes(i) && w.cells.every((j) => b[j] === 1),
          )
          .map((w) => w.cells);
      let witnesses = [];
      if (ex.objective === "open-three")
        witnesses = six
          .filter(
            (w) =>
              !b[w.cells[0]] &&
              !b[w.cells[5]] &&
              all.every((j) => w.cells.slice(1, 5).includes(j)) &&
              w.cells.slice(1, 5).filter((j) => b[j] === 1).length === 3,
          )
          .map((w) => ({ cells: w.cells, axis: w.axis }));
      if (
        ex.objective === "open-four" ||
        ex.objective === "four" ||
        ex.objective === "safe-four"
      )
        witnesses = five
          .filter(
            (w) =>
              (ex.objective === "safe-four" ||
                all.every((j) => w.cells.includes(j))) &&
              w.cells.filter((j) => b[j] === 1).length === 4,
          )
          .map((w) => ({
            cells: w.cells,
            finish: w.cells.find((j) => !b[j]),
            axis: w.axis,
          }));
      if (ex.objective === "two-directions") {
        const anchor = specified.length
            ? specified
            : b.flatMap((s, j) => (s && j !== i ? [j] : [])),
          ws = five.filter(
            (w) =>
              w.cells.includes(i) &&
              anchor.some((j) => j !== i && w.cells.includes(j)),
          );
        for (let a = 0; a < ws.length; a++)
          for (let k = a + 1; k < ws.length; k++)
            if (
              ws[a].axis !== ws[k].axis &&
              anchor.every(
                (j) => ws[a].cells.includes(j) || ws[k].cells.includes(j),
              )
            )
              witnesses.push({
                cells: [...new Set([...ws[a].cells, ...ws[k].cells])],
                axis: [ws[a].axis, ws[k].axis],
              });
      }
      if (win.length || witnesses.length || ex.objective === "prevent-fork")
        plans.set(i, { win, witnesses });
      b[i] = 0;
    }
  return { objective: ex.objective, plans };
}
export function evaluateGoal(b, plan, { details = false } = {}) {
  const accepted = [],
    byMove = {};
  let legal = 0;
  const immediateWhite = wins(b, 2);
  for (const i of empty(b)) {
    legal++;
    const item = plan.plans.get(i);
    if (!item) continue;
    const win = item.win.some((w) => w.every((j) => b[j] !== 2));
    if (win) {
      accepted.push(i);
      byMove[i] = { win: true };
      continue;
    }
    if (immediateWhite.some((j) => j !== i)) continue;
    const ws = item.witnesses.filter((w) => w.cells.every((j) => b[j] !== 2));
    let good = false;
    if (plan.objective === "two-directions" || plan.objective === "open-three")
      good = ws.length > 0;
    if (plan.objective === "four" || plan.objective === "open-four")
      good =
        new Set(ws.map((w) => w.finish)).size >=
        (plan.objective === "four" ? 1 : 2);
    if (plan.objective === "safe-four") {
      const ends = [...new Set(ws.map((w) => w.finish))];
      if (ends.length >= 2) good = true;
      else if (ends.length === 1) {
        b[i] = 1;
        b[ends[0]] = 2;
        good = !won(b, 2) && wins(b, 2).length === 0;
        b[ends[0]] = 0;
        b[i] = 0;
      }
    }
    if (plan.objective === "prevent-fork") {
      b[i] = 1;
      good = !wins(b, 2).length && !forks(b, 2).length;
      b[i] = 0;
    }
    if (good) {
      accepted.push(i);
      if (details)
        byMove[i] = {
          axes: [...new Set(ws.flatMap((w) => w.axis))],
          finishes: [
            ...new Set(
              ws.flatMap((w) => (w.finish === undefined ? [] : [w.finish])),
            ),
          ].sort((a, b) => a - b),
          windows: ws.map((w) => w.cells),
        };
    }
  }
  return { accepted, byMove, legal };
}
export function compileProblem(p) {
  const c = p.nodes[0].choices.find((c) => c.correct),
    ex = c.continuations?.[0],
    pred = p.prediction,
    projected = p.board.map((s) => (s === 1 ? 1 : 0));
  for (const m of ex?.moves || []) if (m.side === 1) projected[m.i] = 1;
  const initial = p.board.map((s) => (s === 1 ? 1 : 0)),
    out = { p, ex };
  if (ex) out.goal = compileGoal(projected, ex);
  if (p.unitId === "branch")
    out.predGoal = compileGoal(projected, {
      objective: "open-four",
      cells: pred.support,
    });
  if (p.unitId === "prepare")
    out.predGoal = compileGoal(projected, {
      objective: "open-three",
      cells: [pred.candidate],
    });
  if (p.unitId === "opening") {
    const pre = [...projected];
    pre[pred.candidate] = 0;
    out.predGoal = compileGoal(pre, {
      objective: "two-directions",
      cells: pred.support,
    });
  }
  return out;
}
export function evaluateProblem(comp, b, { details = false } = {}) {
  const { p, ex } = comp,
    pr = p.prediction,
    c = pr.candidate ?? pr.move,
    r = pr.reply;
  if (
    b.filter((s) => s === 1).length !== b.filter((s) => s === 2).length ||
    won(b, 1) ||
    won(b, 2)
  )
    return null;
  if (p.unitId === "conditions") {
    if (b[c]) return null;
    const a = [...b];
    a[c] = 1;
    if (won(a, 1)) return null;
    const finishes = wins(a, 1);
    if (wins(b, 1).length || wins(b, 2).length) return null;
    return {
      domain:
        finishes.length >= 2 ? "conditions-positive" : "conditions-negative",
      outcome:
        pr.kind === "open-four"
          ? finishes.length >= 2
            ? "yes"
            : "no"
          : ["zero", "one", "two"][Math.min(2, finishes.length)],
      finishes,
      accepted: [],
      legal: 0,
      signature: JSON.stringify([finishes]),
    };
  }
  if (c !== null && c !== undefined && b[c]) return null;
  if (r !== null && r !== undefined && b[r]) return null;
  const a = [...b];
  for (const m of ex?.moves || []) {
    if (a[m.i]) return null;
    a[m.i] = m.side;
    if (won(a, m.side)) return null;
  }
  const res = ex
    ? evaluateGoal(a, comp.goal, { details })
    : { accepted: [], byMove: {}, legal: 0 };
  if (!res.accepted.length) return null;
  if (p.unitId === "counter") {
    if (wins(b, 1).length || wins(b, 2).length) return null;
    const z = [...b];
    z[c] = 1;
    if (!same(wins(z, 1), [r])) return null;
    z[r] = 2;
    if (won(z, 2)) return null;
    const finishes = wins(z, 2),
      domain = finishes.length ? "counter-threat" : "counter-clear";
    return {
      ...res,
      domain,
      outcome:
        finishes.length > 1 ? "open-four" : finishes.length ? "four" : "clear",
      finishes,
      signature: JSON.stringify([finishes, res.accepted]),
    };
  }
  if (
    p.unitId !== "practice" &&
    (wins(b, 1).length ||
      wins(b, 2).length ||
      wins(a, 1).length ||
      wins(a, 2).length)
  )
    return null;
  if (p.unitId === "branch") {
    const prediction = evaluateGoal(a, comp.predGoal, { details: true }),
      yes = prediction.accepted.length > 0;
    return {
      ...res,
      domain: `branch-${yes ? "ready" : "rebuild"}`,
      outcome: yes ? "yes" : "no",
      predictionMoves: prediction.accepted,
      signature: JSON.stringify([prediction.accepted, res.accepted]),
    };
  }
  if (p.unitId === "prepare") {
    const prediction = evaluateGoal(a, comp.predGoal, { details: true }),
      dirs = [
        ...new Set(Object.values(prediction.byMove).flatMap((v) => v.axes)),
      ].sort();
    if (dirs.length < 1 || dirs.length > 2) return null;
    return {
      ...res,
      domain: `prepare-${dirs.length === 2 ? "two" : "one"}`,
      outcome: dirs.length === 2 ? "two" : "one",
      directions: dirs,
      signature: JSON.stringify([dirs, res.accepted]),
    };
  }
  if (p.unitId === "opening") {
    const before = [...a];
    before[c] = 0;
    const prediction = evaluateGoal(before, comp.predGoal, { details: true }),
      yes = prediction.accepted.includes(c),
      near =
        Math.min(
          ...b.flatMap((s, i) =>
            s === 2
              ? [
                  Math.max(
                    Math.abs((i % 15) - (c % 15)),
                    Math.abs(Math.floor(i / 15) - Math.floor(c / 15)),
                  ),
                ]
              : [],
          ),
        ) === 1;
    return {
      ...res,
      domain: `opening-${near ? "near" : "far"}-${yes ? "ready" : "blocked"}`,
      outcome: yes ? "yes" : "no",
      signature: JSON.stringify([yes, res.accepted]),
    };
  }
  const bw = wins(b, 1),
    ww = wins(b, 2),
    wf = ww.length ? [] : forks(b, 2),
    outcome = bw.length ? "win" : ww.length || wf.length ? "defense" : "build";
  if (outcome === "build" && forks(b, 1).length) return null;
  return {
    ...res,
    domain: `practical-${outcome}`,
    outcome,
    blackWins: bw,
    whiteWins: ww,
    whiteForks: wf,
    signature: JSON.stringify([bw, ww, wf, res.accepted]),
  };
}
