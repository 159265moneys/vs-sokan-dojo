import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { data, diagramIds, diagram } from "../dist/strategy-diagrams.js";
import { parse, coord, winner, winningMoves } from "../dist/game.js";
import { problems } from "../dist/curriculum.js";

// Deliberately independent rule checks: no game.js win or threat helpers here.
const axes = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];
const inBoard = (x, y) => x >= 0 && y >= 0 && x < 15 && y < 15;
function lineLength(b, i, color, [dx, dy]) {
  let count = 1;
  for (const sign of [-1, 1]) {
    let x = (i % 15) + sign * dx,
      y = Math.floor(i / 15) + sign * dy;
    while (inBoard(x, y) && b[y * 15 + x] === color) {
      count++;
      x += sign * dx;
      y += sign * dy;
    }
  }
  return count;
}
function won(b, color) {
  return b.some(
    (v, i) =>
      v === color && axes.some((axis) => lineLength(b, i, color, axis) >= 5),
  );
}
function wins(b, color) {
  const out = [];
  for (let i = 0; i < b.length; i++) {
    if (b[i]) continue;
    const after = b.slice();
    after[i] = color;
    if (axes.some((axis) => lineLength(after, i, color, axis) >= 5))
      out.push(i);
  }
  return out;
}
function put(b, at, color = 1) {
  const result = b.slice(),
    i = typeof at === "number" ? at : parse(at);
  assert.equal(result[i], 0, `occupied ${coord(i)}`);
  result[i] = color;
  return result;
}
function openFourEntries(b) {
  return b.flatMap((v, i) => {
    if (v) return [];
    const after = put(b, i);
    return !won(after, 1) && wins(after, 1).length >= 2 ? [i] : [];
  });
}
const cells = (...s) => s.map(parse).sort((a, b) => a - b);
const initial = (id) => data[id].frames[0].board;

test("diagram catalog is complete, immutable, captioned, and shows every stone it describes", () => {
  const required = [
    "five-gap",
    "open-four",
    "closed-four",
    "broken-four",
    "open-three",
    "fake-three",
    "broken-three",
    "fork-four",
    "shared-finish",
    "branch",
    "counter-four",
    "opening",
  ];
  for (const id of required) assert(diagramIds.includes(id));
  assert(Object.isFrozen(data));
  for (const [id, d] of Object.entries(data)) {
    assert.equal(d.id, id);
    assert(d.caption && d.alt && d.title);
    const { x0, x1, y0, y1 } = d.bounds;
    assert(x0 >= 0 && y0 >= 0 && x1 < 15 && y1 < 15);
    if (d.kind === "local") assert(x1 - x0 > y1 - y0);
    else assert.equal(x1 - x0, y1 - y0, id);
    for (const f of d.frames) {
      assert.equal(f.board.length, 225);
      assert(Object.isFrozen(f.board));
      assert(f.caption.length > 0 && f.alt.includes(f.caption));
      f.board.forEach((v, i) => {
        assert([0, 1, 2].includes(v));
        if (v)
          assert(
            i % 15 >= x0 &&
              i % 15 <= x1 &&
              Math.floor(i / 15) >= y0 &&
              Math.floor(i / 15) <= y1,
            `${id} hides ${coord(i)}`,
          );
      });
      for (const m of f.marks) {
        assert.equal(f.board[m.i], 0, `${id}: marked point occupied`);
        assert(m.label && ["finish", "entry", "move"].includes(m.kind));
      }
    }
  }
});

test("every drawn position agrees with game.js and every illustrated move is legal", () => {
  for (const d of Object.values(data)) {
    for (let n = 0; n < d.frames.length; n++) {
      const f = d.frames[n];
      for (const color of [1, 2])
        assert.deepEqual(
          winningMoves(f.board.slice(), color),
          wins(f.board, color),
          `${d.id}/${n}/${color}`,
        );
      const expectedWinner = won(f.board, 1) ? 1 : won(f.board, 2) ? 2 : 0;
      assert.equal(winner(f.board), expectedWinner);
      if (!n) continue;
      const previous = d.frames[n - 1],
        move = f.moves.at(-1);
      assert.equal(
        winner(previous.board),
        0,
        `${d.id}: continued after game ended`,
      );
      assert(f.moves.length > previous.moves.length);
      assert.equal(f.ply, f.moves.length);
      assert.deepEqual(f.moves.slice(0, previous.moves.length), previous.moves);
      assert.equal(f.lastMove, move.i);
      let replayed = previous.board.slice();
      for (let j = previous.moves.length; j < f.moves.length; j++) {
        const next = f.moves[j];
        assert.equal(
          winner(replayed),
          0,
          `${d.id}: continued after game ended between snapshots`,
        );
        assert.equal(next.number, j + 1);
        assert.equal(next.color, (j % 2) + 1);
        replayed = put(replayed, next.i, next.color);
      }
      assert.deepEqual(f.board, replayed);
    }
  }
});

test("five-gap wins with six; open, closed and broken fours count distinct finishing intersections", () => {
  const before = initial("five-gap"),
    after = data["five-gap"].frames[1].board;
  assert(!won(before, 1));
  assert.deepEqual(wins(before, 1), cells("H8"));
  assert.equal(lineLength(after, parse("H8"), 1, [1, 0]), 6);
  assert.equal(winner(after), 1);
  assert.deepEqual(wins(initial("open-four"), 1), cells("E8", "J8"));
  assert.deepEqual(wins(initial("closed-four"), 1), cells("J8"));
  assert.deepEqual(wins(initial("broken-four"), 1), cells("H8"));
  const b = initial("open-four");
  for (const finish of wins(b, 1))
    assert.equal(wins(put(b, finish, 2), 1).length, 1);
});

test("a genuine open three requires the outside space; white stones and the board edge remove it", () => {
  const open = initial("open-three");
  assert.deepEqual(wins(open, 1), []);
  assert.deepEqual(openFourEntries(open), cells("F8", "J8"));
  assert.deepEqual(wins(put(open, "F8"), 1), cells("E8", "J8"));
  assert.deepEqual(wins(put(open, "J8"), 1), cells("F8", "K8"));
  for (const [id, extensions] of [
    ["fake-three", ["F8", "J8"]],
    ["fake-three-edge", ["A8", "E8"]],
  ]) {
    const b = initial(id);
    assert.deepEqual(openFourEntries(b), [], id);
    for (const at of extensions)
      assert.equal(wins(put(b, at), 1).length, 1, `${id}/${at}`);
  }
  assert.equal(initial("fake-three-edge")[parse("F8")], 2);
  assert.equal(data["fake-three-edge"].bounds.x0, 0);
});

test("broken three has one open-four entry, at its interior gap", () => {
  assert.deepEqual(openFourEntries(initial("broken-three")), cells("H8"));
  assert.deepEqual(
    wins(data["broken-three"].frames[1].board, 1),
    cells("E8", "J8"),
  );
});

test("two directional fours can have either two distinct finishes or just one shared finish", () => {
  const fork = data["fork-four"].frames;
  assert.deepEqual(wins(fork[0].board, 1), []);
  assert.deepEqual(wins(fork[1].board, 1), cells("J8", "H10"));
  assert.equal(lineLength(fork[1].board, parse("H8"), 1, [1, 0]), 4);
  assert.equal(lineLength(fork[1].board, parse("H8"), 1, [0, 1]), 4);
  const shared = initial("shared-finish");
  assert.deepEqual(wins(shared, 1), cells("H8"));
  const filled = put(shared, "H8");
  assert.equal(lineLength(filled, parse("H8"), 1, [1, 0]), 5);
  assert.equal(lineLength(filled, parse("H8"), 1, [0, 1]), 5);
  assert.deepEqual(wins(put(shared, "H8", 2), 1), []);
});

test("branch follows the shown response: two threes, horizontal defense, vertical four, five", () => {
  const f = data.branch.frames;
  assert.equal(lineLength(f[1].board, parse("H8"), 1, [1, 0]), 3);
  assert.equal(lineLength(f[1].board, parse("H8"), 1, [0, 1]), 3);
  assert(openFourEntries(f[1].board).includes(parse("E8")));
  assert(openFourEntries(f[1].board).includes(parse("H9")));
  assert.equal(f[2].board[parse("E8")], 2);
  assert(!openFourEntries(f[2].board).includes(parse("I8")));
  assert(openFourEntries(f[2].board).includes(parse("H9")));
  assert.deepEqual(wins(f[3].board, 1), cells("H5", "H10"));
  assert.deepEqual(wins(f[4].board, 1), cells("H10"));
  assert(won(f[5].board, 1));
  for (const frame of f.slice(0, -1))
    assert.deepEqual(wins(frame.board, 2), []);
});

test("branch's full position has no omitted stones or white move that can form a counter-four", () => {
  const d = data.branch,
    frames = d.frames;
  assert.deepEqual(
    frames[0].board.flatMap((color, i) => (color === 2 ? [i] : [])),
    cells("D4", "L4", "D12", "L12"),
  );
  // The four initial white stones are at the visible corners of this crop.
  // Check the entire 15x15 board, including every point outside the drawing.
  for (let step = 0; step < frames.length - 1; step++) {
    const b = frames[step].board;
    for (let i = 0; i < 225; i++) {
      if (b[i]) continue;
      const after = put(b, i, 2);
      assert(!won(after, 2), `white immediate five at ${step}/${coord(i)}`);
      assert.deepEqual(
        wins(after, 2),
        [],
        `white counter-four at ${step}/${coord(i)}`,
      );
    }
  }
  const otherDefense = put(frames[3].board, "H10", 2);
  assert.deepEqual(wins(otherDefense, 1), cells("H5"));
  assert(won(put(otherDefense, "H5"), 1));
});

test("the original counter-four proves the receiving four changes the initiative", () => {
  const d = data["counter-four"],
    f = d.frames;
  assert.deepEqual(d.source, { kind: "original" });
  assert.deepEqual(wins(f[0].board, 1), []);
  assert.deepEqual(wins(f[0].board, 2), []);
  assert.equal(f[0].board.filter((v) => v === 1).length, 5);
  assert.equal(f[0].board.filter((v) => v === 2).length, 5);
  assert.deepEqual(wins(f[1].board, 1), cells("I8"));
  assert.equal(lineLength(f[1].board, parse("H8"), 1, [0, 1]), 3);
  assert.deepEqual(wins(f[2].board, 1), []);
  assert.deepEqual(wins(f[2].board, 2), cells("I5", "I10"));
  for (let i = 0; i < 225; i++) {
    if (f[2].board[i]) continue;
    const response = put(f[2].board, i, 1);
    assert(!won(response, 1));
    assert(wins(response, 2).length > 0, `white still wins after ${coord(i)}`);
  }
  assert.deepEqual(wins(f[3].board, 2), cells("I10"));
  assert(won(f[4].board, 2));
});

test("opening gives connections in two directions without making a best-move or win claim", () => {
  const f = data.opening.frames;
  assert.equal(f[0].board.filter((v) => v === 1).length, 2);
  assert.equal(lineLength(f[1].board, parse("I9"), 1, [0, 1]), 2);
  assert.equal(lineLength(f[1].board, parse("I9"), 1, [1, -1]), 2);
  assert.equal(f[2].board[parse("I10")], 2);
  assert.equal(lineLength(f[3].board, parse("H8"), 1, [1, -1]), 3);
  assert.deepEqual(openFourEntries(f[3].board), cells("F6", "J10"));
  assert.deepEqual(wins(put(f[3].board, "F6"), 1), cells("E5", "J10"));
  assert.deepEqual(wins(put(f[3].board, "J10"), 1), cells("F6", "K11"));
  for (const frame of f) {
    assert(!/最善|必勝|唯一/.test(frame.caption));
    assert.equal(winner(frame.board), 0);
  }
});

test("quiet preparation is the identified foundation position and prepares two later fours", () => {
  const d = data["quiet-preparation"],
    f = d.frames;
  assert.deepEqual(d.source, {
    kind: "existing-lesson",
    problemId: "quiet-shape",
  });
  const source = problems.find((p) => p.id === "quiet-shape");
  assert.deepEqual(f[0].board, Array.from(source.board));
  assert.equal(f.length, 8);
  // No move in the initial diagram creates a four. H8 itself makes neither a
  // winning point nor an open-four entry, so it is still a preparation move.
  for (let i = 0; i < 225; i++) {
    if (f[0].board[i]) continue;
    assert.deepEqual(
      wins(put(f[0].board, i), 1),
      [],
      `premature four at ${coord(i)}`,
    );
  }
  assert.deepEqual(wins(f[1].board, 1), []);
  assert.deepEqual(openFourEntries(f[1].board), []);
  assert.deepEqual(wins(put(f[1].board, "F8"), 1), cells("G8"));
  assert.deepEqual(wins(put(f[1].board, "H10"), 1), cells("H9"));
  assert.equal(f[2].board[parse("H10")], 2);
  assert.match(f[2].caption, /この白応手の一例/);
  assert.equal(f[3].board[parse("F8")], 1);
  assert.deepEqual(wins(f[3].board, 1), cells("G8"));
  assert.equal(f[4].board[parse("G8")], 2);
  assert.equal(f[5].board[parse("F9")], 1);
  assert.deepEqual(wins(f[5].board, 1), cells("F5", "F10"));
  assert.equal(f[6].board[parse("F10")], 2);
  assert.deepEqual(wins(f[6].board, 1), cells("F5"));
  assert.equal(f[7].board[parse("F5")], 1);
  assert.equal(lineLength(f[7].board, parse("F5"), 1, [0, 1]), 5);
  assert(won(f[7].board, 1));
  for (const frame of f) assert.deepEqual(wins(frame.board, 2), []);

  // Verify both four-chasing routes mentioned in the article. These are
  // specific reply lines, not a substitute for the lesson's all-replies proof.
  const leftRoute = put(put(f[3].board, "G8", 2), "F9");
  assert.deepEqual(leftRoute, f[5].board);
  assert.deepEqual(wins(leftRoute, 1), cells("F5", "F10"));
  assert.deepEqual(wins(leftRoute, 2), []);
  const upperRoute = put(put(f[1].board, "F8", 2), "H10");
  assert.deepEqual(wins(upperRoute, 1), cells("H9"));
  assert.deepEqual(wins(upperRoute, 2), []);
  const upperFinish = put(put(upperRoute, "H9", 2), "K13");
  assert.deepEqual(wins(upperFinish, 1), cells("G9", "L14"));
  assert.deepEqual(wins(upperFinish, 2), []);
});

test("whole-game replays the existing original record from an empty board to its first black five", () => {
  const d = data["whole-game"];
  assert.deepEqual(d.source, {
    kind: "existing-game",
    sourceId: "max-white-h7",
  });
  const published = JSON.parse(
    readFileSync(
      new URL("../dist/expert-courses.json", import.meta.url),
      "utf8",
    ),
  ).courses.find((course) => course.id === d.source.sourceId);
  // The tracked published record is also available in a clean CI checkout.
  for (const source of [published]) {
    assert.deepEqual(
      d.recordMoves,
      source.moves.map((m, n) => ({ i: m.i, color: m.side, number: n + 1 })),
    );
    assert.equal(source.forcedOpening.ply, 2);
    assert.equal(source.forcedOpening.i, parse("H7"));
  }
  assert.equal(d.recordMoves.length, 35);
  assert.deepEqual(
    d.frames.map((f) => f.ply),
    [0, 7, 24, 25, 33, 35],
  );
  let b = Array(225).fill(0);
  assert.deepEqual(d.frames[0].board, b);
  for (const [n, move] of d.recordMoves.entries()) {
    assert(!won(b, 1) && !won(b, 2), `record already ended before ${n + 1}`);
    assert.equal(move.color, (n % 2) + 1);
    b = put(b, move.i, move.color);
    assert.equal(winner(b), n === 34 ? 1 : 0);
    assert.equal(won(b, 1), n === 34);
    assert(!won(b, 2));
    const snapshot = d.frames.find((f) => f.ply === n + 1);
    if (snapshot) assert.deepEqual(snapshot.board, b);
  }
  assert.equal(lineLength(b, parse("E5"), 1, [1, 0]), 5);
  assert.equal(b[parse("J5")], 2);
});

test("whole-game snapshots show the stated connections, forced defense and final two finishing points", () => {
  const frames = data["whole-game"].frames;
  const early = frames[1].board;
  for (const at of ["G8", "H8", "G6", "F7"]) assert.equal(early[parse(at)], 1);
  assert.equal(early[parse("G7")], 0);
  assert.equal(lineLength(early, parse("G8"), 1, [1, 0]), 2);
  assert.equal(lineLength(early, parse("G8"), 1, [1, -1]), 2);
  assert.deepEqual(wins(frames[2].board, 1), []);
  assert.deepEqual(wins(frames[2].board, 2), cells("D9"));
  assert.equal(frames[3].board[parse("D9")], 1);
  assert.deepEqual(wins(frames[3].board, 2), []);
  assert.deepEqual(wins(frames[4].board, 1), cells("E5", "J5"));
  assert.deepEqual(wins(frames[4].board, 2), []);
  const lastWhite = put(frames[4].board, "J5", 2);
  assert.deepEqual(wins(lastWhite, 1), cells("E5"));
  assert.deepEqual(put(lastWhite, "E5"), frames[5].board);
  // Between the defensive and final snapshots, the actual game contains
  // three forcing fours; each recorded white reply fills its sole finish.
  const finishes = new Map([
    [27, "I6"],
    [29, "F6"],
    [31, "J3"],
  ]);
  let replay = Array(225).fill(0);
  for (const move of data["whole-game"].recordMoves) {
    replay = put(replay, move.i, move.color);
    if (finishes.has(move.number)) {
      assert.deepEqual(wins(replay, 1), cells(finishes.get(move.number)));
      assert.deepEqual(wins(replay, 2), []);
    }
    if (finishes.has(move.number - 1)) {
      assert.equal(move.i, parse(finishes.get(move.number - 1)));
      assert.deepEqual(wins(replay, 1), []);
    }
  }
  assert.match(
    diagram("whole-game", { step: 4 }),
    /<title[^>]*>[^<]*33手目<\/title>/,
  );
});

test("SVG figures are responsive, independently named, captioned and usable without external assets", () => {
  const seen = new Set();
  for (const id of diagramIds) {
    for (let step = 0; step < data[id].frames.length; step++) {
      const html = diagram(id, { step });
      assert.match(html, /^<figure /);
      assert.match(html, /<figcaption>[^<]+<\/figcaption>/);
      assert.match(html, /viewBox="0 0 \d+ \d+"/);
      assert.match(html, /role="img" aria-labelledby="[^"]+-title [^"]+-desc"/);
      assert.match(html, /width:100%;height:auto/);
      assert.doesNotMatch(html, /<image|<script|<foreignObject|href=/);
      for (const match of html.matchAll(/\bid="([^"]+)"/g)) {
        assert(!seen.has(match[1]), `duplicate SVG id ${match[1]}`);
        seen.add(match[1]);
      }
      for (const m of data[id].frames[step].marks)
        assert(html.includes(`>${m.label}</text>`));
    }
  }
  assert.notEqual(diagram("open-four"), diagram("open-four"));
  assert.throws(() => diagram("toString"), RangeError);
  assert.throws(() => diagram("branch", { step: -1 }), RangeError);
  assert.throws(() => diagram("branch", { step: 1.5 }), RangeError);
  assert.throws(() => diagram("branch", { step: 6 }), RangeError);
});
