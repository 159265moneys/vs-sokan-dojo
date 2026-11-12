// Teaching diagrams. Each source records original work or a known foundation lesson.
// Coordinates and wins use the app's freestyle15 rule.
// Cropped diagrams describe only the stones shown; they do not certify a whole-game win.
import { N, parse, coord } from "./game.js";

const points = (s = "") => (s.trim() ? s.trim().split(/\s+/).map(parse) : []);
const board = (black = "", white = "") => {
  const result = Array(N * N).fill(0);
  for (const [color, cells] of [
    [1, points(black)],
    [2, points(white)],
  ]) {
    for (const i of cells) {
      if (result[i]) throw Error(`Diagram stone overlaps at ${coord(i)}`);
      result[i] = color;
    }
  }
  return result;
};
const mark = (at, label, kind = "finish") => ({ i: parse(at), label, kind });
const names = (b, color) =>
  b.flatMap((v, i) => (v === color ? [coord(i)] : [])).join("・") || "なし";
const frame = (b, caption, marks = [], moves = []) => ({
  board: b.slice(),
  caption,
  alt: `${caption} 黒石は${names(b, 1)}。白石は${names(b, 2)}。${marks.map((m) => `${m.label}は${coord(m.i)}の空点。`).join("")}`,
  marks,
  moves: moves.slice(),
  ply: moves.length,
  lastMove: moves.at(-1)?.i ?? null,
});
const sequence = (initial, steps) => {
  const b = initial.slice(),
    moves = [];
  return steps.map(({ at, caption, marks = [] }, n) => {
    if (at) {
      const i = parse(at),
        color = (moves.length % 2) + 1;
      if (b[i]) throw Error(`Diagram move overlaps at ${at}`);
      b[i] = color;
      moves.push({ i, color, number: moves.length + 1 });
    } else if (n) throw Error("Only the first diagram frame can omit a move");
    return frame(b, caption, marks, moves);
  });
};
const localBounds = { x0: 3, x1: 11, y0: 6, y1: 8 };
const squareBounds = { x0: 3, x1: 11, y0: 3, y1: 11 };
const local = (id, title, frames, bounds = localBounds) => ({
  id,
  title,
  kind: "local",
  bounds,
  frames,
  source: { kind: "original" },
});
const square = (
  id,
  title,
  frames,
  bounds = squareBounds,
  source = { kind: "original" },
) => ({
  id,
  title,
  kind: "board",
  bounds,
  frames,
  source,
});

// Existing max-white-h7 record; its second move, white H7, was a set opening.
// Source: artifacts/expert-course-max-white-h7.json and dist/expert-courses.json.
const wholeGameMoves = points(
  "H8 H7 G6 H6 F7 E8 G8 G7 I5 E9 I7 I8 J6 K5 F8 G9 H4 G3 I4 F9 H9 E6 E7 C9 D9 D7 I3 I6 G5 F6 H5 J3 F5 J5 E5",
).map((i, n) => ({ i, color: (n % 2) + 1, number: n + 1 }));
const wholeGameCheckpoints = [
  { ply: 0, caption: "空盤から始める一局の例。黒が先手。" },
  { ply: 7, caption: "7手目、黒G8。H8と横、G6と縦、F7と斜めにつながる。" },
  {
    ply: 24,
    caption:
      "24手目、白C9。C9・E9・F9・G9の四で、A（D9）が白の完成点。黒に今すぐ五連はない。",
    marks: [mark("D9", "A")],
  },
  {
    ply: 25,
    caption: "25手目、黒D9。白の四を塞いで、白の完成点がなくなった。",
  },
  {
    ply: 33,
    caption:
      "33手目、黒F5。F5からI5までの活四で、A（E5）とB（J5）が完成点。白の即勝ちはない。",
    marks: [mark("E5", "A"), mark("J5", "B")],
  },
  {
    ply: 35,
    caption: "35手目、黒E5。白34（J5）が片側を止めた後、E5からI5まで五連。",
  },
];
function recordFrames(record, checkpoints) {
  const b = board(),
    history = [],
    frames = [];
  for (let ply = 0; ply <= record.length; ply++) {
    const checkpoint = checkpoints.find((item) => item.ply === ply);
    if (checkpoint)
      frames.push(
        frame(b, checkpoint.caption, checkpoint.marks || [], history),
      );
    if (ply === record.length) break;
    const move = record[ply];
    if (b[move.i]) throw Error(`Record stone overlaps at ${coord(move.i)}`);
    b[move.i] = move.color;
    history.push(move);
  }
  return frames;
}

const definitions = [
  local(
    "five-gap",
    "空点を埋めて五つ以上",
    sequence(board("E8 F8 G8 I8 J8"), [
      {
        caption: "A（H8）を埋めると、E8からJ8まで六つつながる。",
        marks: [mark("H8", "A")],
      },
      { at: "H8", caption: "黒1で六連。五つ以上の連続で勝ちになる。" },
    ]),
  ),
  local("open-four", "活四：完成点は二つ", [
    frame(
      board("F8 G8 H8 I8"),
      "A（E8）とB（J8）のどちらでも五連。一方を塞いでも、もう一方が残る。",
      [mark("E8", "A"), mark("J8", "B")],
    ),
  ]),
  local("closed-four", "片側が閉じた四", [
    frame(
      board("F8 G8 H8 I8", "E8"),
      "左端は白。黒が次に五連を作れるのはA（J8）の一か所。",
      [mark("J8", "A")],
    ),
  ]),
  local("broken-four", "切れ目のある四", [
    frame(
      board("F8 G8 I8 J8"),
      "四つの黒石の間に切れ目がある。A（H8）を埋めると五連になる。",
      [mark("H8", "A")],
    ),
  ]),
  local("open-three", "活三：一つ外側まで見る", [
    frame(
      board("G8 H8 I8"),
      "A（F8）かB（J8）で活四になる。さらに外側のE8・K8も空いている。",
      [mark("F8", "A", "entry"), mark("J8", "B", "entry")],
    ),
  ]),
  local("fake-three", "両端が空いているだけでは足りない", [
    frame(
      board("G8 H8 I8", "E8 K8"),
      "A（F8）・B（J8）は空点でも、その外側は白。どちらへ延ばしても完成点は一つで、活四にならない。",
      [mark("F8", "A", "entry"), mark("J8", "B", "entry")],
    ),
  ]),
  local(
    "fake-three-edge",
    "盤端も外側を閉じる",
    [
      frame(
        board("B8 C8 D8", "F8"),
        "A（A8）の外側は盤端、B（E8）の外側は白。どちらへ延ばしても完成点は一つ。",
        [mark("A8", "A", "entry"), mark("E8", "B", "entry")],
      ),
    ],
    { x0: 0, x1: 6, y0: 6, y1: 8 },
  ),
  local(
    "broken-three",
    "切れ目をつなぐ三",
    sequence(board("F8 G8 I8"), [
      {
        caption: "A（H8）で内側の切れ目を埋めると活四になる。",
        marks: [mark("H8", "A", "entry")],
      },
      {
        at: "H8",
        caption: "黒1で四つが連続。A（E8）とB（J8）の二つが完成点。",
        marks: [mark("E8", "A"), mark("J8", "B")],
      },
    ]),
  ),
  square(
    "fork-four",
    "同じ一手で二方向の四",
    sequence(board("F8 G8 I8 H6 H7 H9", "E8 H5"), [
      {
        caption: "黒は1（H8）で、横と縦の切れ目を同時につなぐ。",
        marks: [mark("H8", "1", "move")],
      },
      {
        at: "H8",
        caption:
          "黒1で横のA（J8）、縦のB（H10）が完成点になる。受ける場所は二つ。",
        marks: [mark("J8", "A"), mark("H10", "B")],
      },
    ]),
  ),
  square(
    "shared-finish",
    "四が二本でも完成点は一つ",
    sequence(board("F8 G8 I8 J8 H6 H7 H9 H10"), [
      {
        caption:
          "横と縦の四は、どちらもA（H8）を埋める形。完成点は同じ一か所。",
        marks: [mark("H8", "A")],
      },
    ]),
  ),
  square(
    "branch",
    "横を受けられたら縦へ",
    sequence(board("F8 G8 H6 H7", "D4 L4 D12 L12"), [
      {
        caption: "1（H8）で、横と縦の石をつなげる。",
        marks: [mark("H8", "1", "move")],
      },
      { at: "H8", caption: "黒1で横F8–H8と縦H6–H8に三ができた。" },
      {
        at: "E8",
        caption: "白2が横の一端を塞いだ例。縦の伸びる場所は残っている。",
        marks: [mark("H9", "3", "move")],
      },
      {
        at: "H9",
        caption: "黒3で縦の活四。A（H5）とB（H10）が完成点。",
        marks: [mark("H5", "A"), mark("H10", "B")],
      },
      {
        at: "H5",
        caption: "白4がH5を塞いでも、B（H10）が残る。",
        marks: [mark("H10", "B")],
      },
      { at: "H10", caption: "黒5でH6からH10まで五連。" },
    ]),
  ),
  // A new counterexample. Teaching diagrams never source assessment-bank.js.
  square(
    "counter-four",
    "受ける白石が四を作る",
    sequence(board("E8 F8 G8 H7 H9", "D8 I6 I7 I9 B2"), [
      {
        caption:
          "黒1（H8）は横の四と縦の三を作る形。受けるI8の周囲には白石が集まっている。",
        marks: [mark("H8", "1", "move")],
      },
      {
        at: "H8",
        caption: "黒1で横の四と縦の三。横の完成点はA（I8）の一つ。",
        marks: [mark("I8", "A")],
      },
      {
        at: "I8",
        caption:
          "白2は黒の四を止め、I6–I9に白の活四を作った。白の完成点はA（I5）とB（I10）。",
        marks: [mark("I5", "A"), mark("I10", "B")],
      },
      {
        at: "I5",
        caption:
          "黒3がI5を塞いでも、B（I10）が残る。黒の縦の三を伸ばす時間はない。",
        marks: [mark("I10", "B")],
      },
      {
        at: "I10",
        caption:
          "白4でI6からI10まで五連。四三という形だけでは勝ちを決められない。",
      },
    ]),
    { x0: 0, x1: 14, y0: 0, y1: 14 },
  ),
  square(
    "opening",
    "二つの石から二方向へ",
    sequence(board("H8 I8", "F5 K12"), [
      {
        caption: "隣り合う二つの黒石から、つながる方向を増やす一例。",
        marks: [mark("I9", "1", "move")],
      },
      { at: "I9", caption: "黒1はI8と縦、H8と斜めにつながる。" },
      {
        at: "I10",
        caption: "白2が縦の一端を塞いだ。斜めのG7は空いている。",
        marks: [mark("G7", "3", "move")],
      },
      {
        at: "G7",
        caption: "黒3でG7・H8・I9の斜めの三。二方向へのつながりを残す考え方。",
      },
    ]),
  ),
  square(
    "quiet-preparation",
    "今の形より、次の二方向",
    sequence(
      board("D8 E8 F6 F7 H11 H12 I11 J12", "C8 D5 J8 L11 H13 L10 M13 B4"),
      [
        {
          caption:
            "今は四を作る一手がない。1（H8）で、左側と上側の石を次の攻めにつなぐ。",
          marks: [mark("H8", "1", "move")],
        },
        {
          at: "H8",
          caption:
            "黒1はまだ活三や四を作らない。A（F8）から横の四、B（H10）から縦の四を始める準備。",
          marks: [mark("F8", "A", "entry"), mark("H10", "B", "entry")],
        },
        {
          at: "H10",
          caption:
            "白2が上側を止める、この白応手の一例。左側のA（F8）は残っている。",
          marks: [mark("F8", "A", "entry")],
        },
        {
          at: "F8",
          caption:
            "黒3でD8・E8・F8・H8の四。準備したH8が加わり、A（G8）が五連の完成点になる。",
          marks: [mark("G8", "A")],
        },
        {
          at: "G8",
          caption:
            "白4が横の完成点を塞いだ。黒F8は縦のF6・F7ともつながっている。",
          marks: [mark("F9", "5", "move")],
        },
        {
          at: "F9",
          caption: "黒5でF6からF9まで縦の活四。A（F5）とB（F10）が完成点。",
          marks: [mark("F5", "A"), mark("F10", "B")],
        },
        {
          at: "F10",
          caption: "白6がF10を塞いでも、A（F5）が残る。",
          marks: [mark("F5", "A")],
        },
        {
          at: "F5",
          caption:
            "黒7でF5からF9まで五連。H8の準備から、横の四、縦の四へつないだ。",
        },
      ],
    ),
    { x0: 0, x1: 14, y0: 0, y1: 14 },
    { kind: "existing-lesson", problemId: "quiet-shape" },
  ),
  square(
    "board-reading",
    "15路の交点と座標",
    [
      frame(
        board("H8"),
        "横はAからO、縦は1から15。石は線の交点に置く。中央の黒石はH8。",
      ),
    ],
    { x0: 0, x1: 14, y0: 0, y1: 14 },
  ),
  {
    ...square(
      "whole-game",
      "空盤から五連までの一局",
      recordFrames(wholeGameMoves, wholeGameCheckpoints),
      { x0: 0, x1: 14, y0: 0, y1: 14 },
      { kind: "existing-game", sourceId: "max-white-h7" },
    ),
    recordMoves: wholeGameMoves,
  },
];

const freeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
};
export const data = freeze(
  Object.fromEntries(
    definitions.map((d) => [
      d.id,
      {
        ...d,
        caption: d.frames[0].caption,
        alt: d.frames[0].alt,
      },
    ]),
  ),
);
export const diagramIds = Object.freeze(Object.keys(data));
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let serial = 0;

/** A self-contained, responsive, accessible SVG figure. Step is zero-based. */
export function diagram(id, { step = 0 } = {}) {
  const d = Object.hasOwn(data, id) ? data[id] : null;
  if (!d) throw new RangeError(`Unknown strategy diagram: ${id}`);
  if (!Number.isInteger(step) || step < 0 || step >= d.frames.length)
    throw new RangeError(`Invalid step ${step} for strategy diagram ${id}`);
  const f = d.frames[step],
    b = d.bounds,
    pitch = 36,
    margin = 28;
  const width = (b.x1 - b.x0) * pitch + margin * 2;
  const height = (b.y1 - b.y0) * pitch + margin * 2;
  const coordinateFont = width > 400 ? 17 : 11;
  const stoneFont = width > 400 ? 18 : 14;
  const xy = (i) => [
    margin + ((i % N) - b.x0) * pitch,
    margin + (Math.floor(i / N) - b.y0) * pitch,
  ];
  const uid = `strategy-${d.id}-${step}-${++serial}`;
  const svg = [
    `<title id="${uid}-title">${esc(d.title)}${d.frames.length > 1 ? `・${f.ply === 0 ? "着手前" : `${f.ply}手目`}` : ""}</title>`,
    `<desc id="${uid}-desc">${esc(f.alt)}</desc>`,
    `<rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="10" fill="#ead0a0" stroke="#b69360"/>`,
  ];
  const grid = (x1, y1, x2, y2, edge) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#785b35" stroke-width="${edge ? 2.2 : 1}"/>`;
  const continuation = (x1, y1, x2, y2) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#785b35" stroke-width="1" stroke-dasharray="2 2"/>`;
  for (let x = b.x0; x <= b.x1; x++) {
    const px = margin + (x - b.x0) * pitch;
    svg.push(grid(px, margin, px, height - margin, x === 0 || x === 14));
    if (b.y0 > 0) svg.push(continuation(px, margin - 9, px, margin));
    if (b.y1 < 14)
      svg.push(continuation(px, height - margin, px, height - margin + 9));
    svg.push(
      `<text x="${px}" y="${coordinateFont + 2}" text-anchor="middle" fill="#564127" font-size="${coordinateFont}">${String.fromCharCode(65 + x)}</text>`,
    );
  }
  for (let y = b.y0; y <= b.y1; y++) {
    const py = margin + (y - b.y0) * pitch;
    svg.push(grid(margin, py, width - margin, py, y === 0 || y === 14));
    if (b.x0 > 0) svg.push(continuation(margin - 9, py, margin, py));
    if (b.x1 < 14)
      svg.push(continuation(width - margin, py, width - margin + 9, py));
    svg.push(
      `<text x="12" y="${py + coordinateFont * 0.34}" text-anchor="middle" fill="#564127" font-size="${coordinateFont}">${N - y}</text>`,
    );
  }
  for (const [x, y] of [
    [3, 3],
    [11, 3],
    [7, 7],
    [3, 11],
    [11, 11],
  ]) {
    if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1)
      svg.push(
        `<circle cx="${margin + (x - b.x0) * pitch}" cy="${margin + (y - b.y0) * pitch}" r="2.5" fill="#785b35"/>`,
      );
  }
  const numbered = new Map(f.moves.map((m) => [m.i, m.number]));
  f.board.forEach((color, i) => {
    if (!color) return;
    const x = i % N,
      y = Math.floor(i / N);
    if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) return;
    const [cx, cy] = xy(i);
    svg.push(
      `<circle cx="${cx}" cy="${cy}" r="13.5" fill="${color === 1 ? "#202a2b" : "#fffaf0"}" stroke="${color === 1 ? "#111a1b" : "#6f5a3e"}" stroke-width="1.5"/>`,
    );
    if (numbered.has(i))
      svg.push(
        `<text x="${cx}" y="${cy + stoneFont * 0.34}" text-anchor="middle" font-size="${stoneFont}" font-weight="700" fill="${color === 1 ? "#fffaf0" : "#202a2b"}">${numbered.get(i)}</text>`,
      );
  });
  for (const m of f.marks) {
    const [cx, cy] = xy(m.i),
      isMove = m.kind === "move";
    svg.push(
      `<circle cx="${cx}" cy="${cy}" r="12" fill="${isMove ? "#294c50" : "#fff7df"}" stroke="${isMove ? "#294c50" : "#785027"}" stroke-width="1.8"${m.kind === "entry" ? ' stroke-dasharray="3 2"' : ""}/>`,
    );
    svg.push(
      `<text x="${cx}" y="${cy + stoneFont * 0.34}" text-anchor="middle" font-size="${stoneFont}" font-weight="700" fill="${isMove ? "#ffffff" : "#533719"}">${esc(m.label)}</text>`,
    );
  }
  return `<figure class="strategy-diagram strategy-diagram--${d.kind}" data-diagram="${esc(id)}" data-step="${step}"><div class="strategy-diagram__label">${d.kind === "local" ? "局所図" : b.x0 === 0 && b.x1 === 14 ? "15路盤" : "局所図"}</div><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${uid}-title ${uid}-desc" preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;height:auto;max-width:${width}px;font-family:system-ui,sans-serif">${svg.join("")}</svg><figcaption>${esc(f.caption)}</figcaption></figure>`;
}
