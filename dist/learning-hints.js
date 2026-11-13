// Hints identify a concrete tactical line; proximity alone is not evidence.
// This helper owns no attempt state and never changes hint usage or progress.
const axes = [[1, 0], [0, 1], [1, 1], [1, -1]];
const segments = { 5: [], 6: [] };
for (const size of [5, 6])
  for (let y = 0; y < 15; y++)
    for (let x = 0; x < 15; x++)
      for (const [dx, dy] of axes) {
        const ex = x + (size - 1) * dx;
        const ey = y + (size - 1) * dy;
        if (ex < 0 || ex >= 15 || ey < 0 || ey >= 15) continue;
        segments[size].push(Array.from(
          { length: size },
          (_, k) => (y + k * dy) * 15 + x + k * dx,
        ));
      }

const point = (i) => Number.isInteger(i) && i >= 0 && i < 225;
const unique = (items) => [...new Set(items)].sort((a, b) => a - b);
const mark = (cells, points = [], tone = "focus") => ({
  cells: unique(cells), points: unique(points), tone,
});

function groups(board, side, count, through = null) {
  const found = new Map();
  for (const window of segments[5]) {
    if (through !== null && !window.includes(through)) continue;
    if (window.some((i) => board[i] === 3 - side)) continue;
    const stones = window.filter((i) => board[i] === side);
    if (stones.length !== count) continue;
    const key = stones.join(",");
    const group = found.get(key) || { cells: stones, points: [] };
    group.points = unique([...group.points, ...window.filter((i) => !board[i])]);
    found.set(key, group);
  }
  return [...found.values()];
}

function completions(board, side) {
  return unique(groups(board, side, 4).flatMap((g) => g.points));
}

function forkFacts(board, side) {
  const candidates = unique(groups(board, side, 3).flatMap((g) => g.points));
  const facts = [];
  for (const move of candidates) {
    const after = [...board];
    after[move] = side;
    if (groups(after, side, 5, move).length || completions(after, 3 - side).length)
      continue;
    const lines = groups(after, side, 4, move);
    if (unique(lines.flatMap((g) => g.points)).length >= 2)
      facts.push({ move, lines });
  }
  return facts;
}

function openThreeGroups(board, side, through) {
  const found = new Map();
  for (const window of segments[6]) {
    if (board[window[0]] || board[window[5]]) continue;
    const middle = window.slice(1, 5);
    if (!middle.includes(through) || middle.some((i) => board[i] === 3 - side))
      continue;
    const cells = middle.filter((i) => board[i] === side);
    if (cells.length === 3) found.set(cells.join(","), { cells });
  }
  return [...found.values()];
}

function fourBlockers(board, side, through) {
  // Removing this occupied completion would add a five through the candidate.
  // Unrelated nearby white stones are never included.
  return unique(segments[5].flatMap((window) => {
    if (!window.includes(through)) return [];
    const own = window.filter((i) => board[i] === side);
    const blockers = window.filter((i) => board[i] === 3 - side);
    return own.length === 4 && blockers.length === 1 ? blockers : [];
  }));
}

/**
 * Return three hint stages for an already-authored set of candidate moves.
 * Stage 1 shows one actual supporting line, stage 2 adds the other relevant
 * lines and occupied completion points, and stage 3 reveals the candidates.
 * A quiet candidate with no such witness receives no speculative stone glow.
 * This is a local geometry aid, not a claim that a move wins the whole game.
 */
export function tacticalHintStages(board, guide, side = 1) {
  if (!board || board.length !== 225 ||
      !Array.from(board).every((s) => s === 0 || s === 1 || s === 2) ||
      ![1, 2].includes(side)) return [[], [], []];
  const candidates = unique((Array.isArray(guide) ? guide : [])
    .filter((i) => point(i) && !board[i]));
  if (!candidates.length) return [[], [], []];
  const enemy = 3 - side;
  const enemyWins = groups(board, enemy, 4);
  let enemyForks;
  const actions = candidates.map((move) => {
    const after = [...board];
    after[move] = side;
    const finish = groups(after, side, 5, move);
    if (finish.length) return { score: 5, move, color: side, lines: finish };
    const stopped = enemyWins.filter((g) => g.points.includes(move));
    if (stopped.length)
      return { score: 4, move, color: enemy, lines: stopped };
    const fours = groups(after, side, 4, move);
    if (fours.length && !completions(after, enemy).length)
      return {
        score: 3, move, color: side, lines: fours,
        blockers: fourBlockers(after, side, move),
      };
    enemyForks ||= forkFacts(board, enemy);
    const prevented = enemyForks.filter((fact) => {
      if (fact.move === move) return true;
      const reply = [...after];
      reply[fact.move] = enemy;
      return completions(reply, enemy).length < 2;
    });
    if (prevented.length)
      return {
        score: 2, move, color: enemy,
        lines: prevented.flatMap((fact) => fact.lines),
      };
    const threes = openThreeGroups(after, side, move);
    return threes.length && !completions(after, enemy).length
      ? { score: 1, move, color: side, lines: threes }
      : { score: 0, move, color: side, lines: [] };
  });
  // Focus on one candidate's strongest witnessed action, not the union of
  // every possible line around every answer in a dense tactical position.
  actions.sort((a, b) => b.score - a.score || a.move - b.move);
  const action = actions[0];
  const supports = action.lines.map((line) =>
    line.cells.filter((i) => board[i] === action.color));
  const tone = action.color === side ? "focus" : "danger";
  const first = supports[0]?.length ? [mark(supports[0], [], tone)] : [];
  const cells = unique(supports.flat());
  const second = cells.length ? [mark(cells, [], tone)] : [];
  if (action.blockers?.length) second.push(mark(action.blockers, [], "danger"));
  const third = second.map((highlight) => ({
    ...highlight, cells: [...highlight.cells], points: [...highlight.points],
  }));
  third.push(mark([], candidates));
  return [first, second, third];
}
