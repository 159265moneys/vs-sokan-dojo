import {
  five,
  six,
  compileProblem,
  rolesFingerprint,
  wins,
  same,
} from "./reserve-oracle-v5.mjs";

export function reserveDiagnostic(p, f) {
  const pr = p.prediction,
    c = pr.candidate ?? pr.move,
    r = pr.reply,
    ex = p.nodes[0].choices.find((c) => c.correct).continuations?.[0],
    a = [...p.board],
    bs = new Set(),
    ws = new Set();
  if (c != null) a[c] = 1;
  const prefix = [...p.board];
  for (const m of ex?.moves || []) prefix[m.i] = m.side;
  const addBlack = (xs) =>
      xs.forEach((i) => {
        if (p.board[i] === 1 || i === c) bs.add(i);
      }),
    addWhites = (windows) =>
      windows.forEach((w) =>
        w.cells.forEach((i) => {
          if (p.board[i] === 2 || (i === r && prefix[i] === 2)) ws.add(i);
        }),
      );
  if (p.unitId === "conditions") {
    addBlack(pr.focusCells || []);
    addWhites(
      five.filter(
        (w) =>
          w.cells.includes(c) && w.cells.filter((i) => a[i] === 1).length === 4,
      ),
    );
  }
  if (p.unitId === "counter") {
    const candidate = [...p.board];
    candidate[c] = 1;
    for (const w of five)
      if (
        w.cells.includes(c) &&
        w.cells.includes(r) &&
        w.cells.filter((i) => candidate[i] === 1).length === 4
      )
        addBlack(w.cells);
    const response = [...candidate];
    response[r] = 2;
    for (const w of five)
      if (w.cells.includes(r) && w.cells.every((i) => response[i] !== 1))
        for (const i of w.cells) if (p.board[i] === 2) ws.add(i);
    for (let i = 0; i < 225; i++)
      if (p.board[i] === 1) {
        response[i] = 0;
        if (!same(wins(response, 2), f.finishes)) bs.add(i);
        response[i] = 1;
      }
  }
  if (p.unitId === "branch") {
    addBlack(pr.support);
    addBlack(ex.cells);
    for (const w of five)
      if (
        w.cells.includes(c) &&
        w.cells.includes(r) &&
        w.cells.filter((i) => a[i] === 1).length >= 3
      )
        addBlack(w.cells);
    addWhites(five.filter((w) => pr.support.every((i) => w.cells.includes(i))));
  }
  if (p.unitId === "prepare") {
    addBlack(pr.support);
    addWhites(
      six.filter(
        (w) =>
          w.cells.includes(c) &&
          w.cells.filter((i) => prefix[i] === 1).length >= 2,
      ),
    );
  }
  if (p.unitId === "opening") {
    addBlack(pr.support);
    addWhites(
      five.filter(
        (w) =>
          w.cells.includes(c) && pr.support.some((i) => w.cells.includes(i)),
      ),
    );
  }
  if (p.unitId === "practice") {
    if (f.outcome === "win") {
      for (const w of five)
        if (
          w.cells.filter((i) => p.board[i] === 1).length === 4 &&
          w.cells.every((i) => p.board[i] !== 2)
        )
          addBlack(w.cells);
    } else if (f.outcome === "build") addBlack(ex.cells);
    else
      for (const w of five)
        if (w.cells.filter((i) => p.board[i] === 2).length >= 3)
          addBlack(w.cells);
    addWhites(
      five.filter((w) => w.cells.filter((i) => p.board[i] === 2).length >= 3),
    );
    if (f.outcome === "build") {
      const compiled = compileProblem(p);
      for (const v of compiled.goal.plans.values()) addWhites(v.witnesses);
    }
  }
  const roleItems = [
    ...[...bs].map((i) => [i, "S"]),
    ...[...ws].map((i) => [i, "W"]),
  ];
  if (c != null) roleItems.push([c, "C"]);
  if (r != null && ws.has(r)) roleItems.push([r, "R"]);
  for (const [k, t] of [
    ["accepted", "A"],
    ["finishes", "F"],
    ["whiteWins", "I"],
    ["whiteForks", "Q"],
  ])
    for (const i of f[k] || []) roleItems.push([i, t]);
  return {
    signature: f.domain + "|" + rolesFingerprint(roleItems),
    black: [...bs],
    white: [...ws],
    ignoredAuxiliary: p.board.flatMap((s, i) =>
      s && !(s === 1 ? bs : ws).has(i) ? [i] : [],
    ),
  };
}
