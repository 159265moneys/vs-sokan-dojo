import { parse, coord } from "./game.js";
import { completionPoints, exerciseMoves } from "./learning-objectives.js";

const points = (text = "") => text.split(/\s+/).filter(Boolean).map(parse);
const freeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const makeBoard = (black, white) => {
  const board = Array(225).fill(0);
  for (const [text, side] of [
    [black, 1],
    [white, 2],
  ])
    for (const i of points(text)) {
      if (board[i]) throw Error(`局面比較盤の重複: ${coord(i)}`);
      board[i] = side;
    }
  return board;
};

// Authored local facts and all accepted continuations. The independent test
// enumerates board geometry rather than deriving its oracle from these guides.
const definitions = [
  {
    id: "check-branch-v5-double-interior-gap-ready",
    role: "assessment",
    unitId: "branch",
    family: "branch/double-interior-gap",
    domain: "branch-ready",
    comparisonGroup: "B1",
    black: "E9 G9 H6 H8",
    white: "C4 K12 M5 B13",
    candidate: "H9",
    reply: "F9",
    focus: "H6 H8 H9",
    arms: [],
    outcome: "yes",
    objective: "open-four",
    cells: "H6 H8 H9",
    guide: "H7",
  },
  {
    id: "check-branch-v5-double-interior-gap-rebuild",
    role: "assessment",
    unitId: "branch",
    family: "branch/double-interior-gap",
    domain: "branch-rebuild",
    comparisonGroup: "B1",
    black: "E9 G9 H6 H8",
    white: "H5 K12 M5 B13",
    candidate: "H9",
    reply: "F9",
    focus: "H6 H8 H9",
    arms: [],
    outcome: "no",
    objective: "two-directions",
    cells: "E9 H8",
    guide: "H12 E11 F10 D8 E8 F8 G7 E5",
  },
  {
    id: "check-branch-v5-offset-arm-ready",
    role: "assessment",
    unitId: "branch",
    family: "branch/offset-arm",
    domain: "branch-ready",
    comparisonGroup: "B2",
    black: "D11 F9 G5 G6",
    white: "B4 L11 M6 K13",
    candidate: "G8",
    reply: "E10",
    focus: "G5 G6 G8",
    arms: [],
    outcome: "yes",
    objective: "open-four",
    cells: "G5 G6 G8",
    guide: "G7",
  },
  {
    id: "check-branch-v5-offset-arm-rebuild",
    role: "assessment",
    unitId: "branch",
    family: "branch/offset-arm",
    domain: "branch-rebuild",
    comparisonGroup: "B2",
    black: "D11 F9 G5 G6",
    white: "B4 L11 M6 G9",
    candidate: "G8",
    reply: "E10",
    focus: "G5 G6 G8",
    arms: [],
    outcome: "no",
    objective: "two-directions",
    cells: "F9 G6",
    guide: "D9 E8 F7 H7 C6 F6 I6 F5",
  },
  {
    id: "check-branch-v5-crossed-oblique-ready",
    role: "assessment",
    unitId: "branch",
    family: "branch/crossed-oblique",
    domain: "branch-ready",
    comparisonGroup: "B3",
    black: "D7 E8 H7 I6",
    white: "B12 L3 M11 K13",
    candidate: "F9",
    reply: "C6",
    focus: "F9 H7 I6",
    arms: [],
    outcome: "yes",
    objective: "open-four",
    cells: "F9 H7 I6",
    guide: "G8",
  },
  {
    id: "check-branch-v5-crossed-oblique-rebuild",
    role: "assessment",
    unitId: "branch",
    family: "branch/crossed-oblique",
    domain: "branch-rebuild",
    comparisonGroup: "B3",
    black: "D7 E8 H7 I6",
    white: "B12 L3 M11 E10",
    candidate: "F9",
    reply: "C6",
    focus: "F9 H7 I6",
    arms: [],
    outcome: "no",
    objective: "two-directions",
    cells: "E8 H7",
    guide: "H11 G8 H8 I8 E7 F7 G6 H5 E4",
  },
  {
    id: "practice-branch-v5-edge-gap-remedial-ready",
    role: "lesson",
    unitId: "branch",
    family: "branch/edge-gap-remedial",
    domain: "branch-ready",
    comparisonGroup: "BL",
    black: "B5 C5 D2 D4",
    white: "B11 F13 L4 M8",
    candidate: "D5",
    reply: "A5",
    focus: "D2 D4 D5",
    arms: [],
    outcome: "yes",
    objective: "open-four",
    cells: "D2 D4 D5",
    guide: "D3",
  },
  {
    id: "practice-branch-v5-edge-gap-remedial-rebuild",
    role: "lesson",
    unitId: "branch",
    family: "branch/edge-gap-remedial",
    domain: "branch-rebuild",
    comparisonGroup: "BL",
    black: "B5 C5 D2 D4",
    white: "B11 F13 L4 D6",
    candidate: "D5",
    reply: "A5",
    focus: "D2 D4 D5",
    arms: [],
    outcome: "no",
    objective: "two-directions",
    cells: "C5 D4",
    guide: "E5 C4 C3",
  },
  {
    id: "check-prepare-v5-two-wide-gaps-two",
    role: "assessment",
    unitId: "prepare",
    family: "prepare/two-wide-gaps",
    domain: "prepare-two",
    comparisonGroup: "P1",
    black: "E8 H5",
    white: "C13 L4",
    candidate: "H8",
    reply: "J11",
    focus: "E8 H5",
    arms: ["E8 H8", "H5 H8"],
    outcome: "two",
    objective: "open-three",
    cells: "H8",
    guide: "F8 G8 H7 H6",
  },
  {
    id: "check-prepare-v5-two-wide-gaps-one",
    role: "assessment",
    unitId: "prepare",
    family: "prepare/two-wide-gaps",
    domain: "prepare-one",
    comparisonGroup: "P1",
    black: "E8 H5",
    white: "D8 L4",
    candidate: "H8",
    reply: "J11",
    focus: "E8 H5",
    arms: ["E8 H8", "H5 H8"],
    outcome: "one",
    objective: "open-three",
    cells: "H8",
    guide: "H7 H6",
  },
  {
    id: "check-prepare-v5-oblique-and-wide-two",
    role: "assessment",
    unitId: "prepare",
    family: "prepare/oblique-and-wide",
    domain: "prepare-two",
    comparisonGroup: "P2",
    black: "E10 G5",
    white: "L12 C3",
    candidate: "G8",
    reply: "K10",
    focus: "E10 G5",
    arms: ["E10 G8", "G5 G8"],
    outcome: "two",
    objective: "open-three",
    cells: "G8",
    guide: "D11 F9 G7 H7 G6",
  },
  {
    id: "check-prepare-v5-oblique-and-wide-one",
    role: "assessment",
    unitId: "prepare",
    family: "prepare/oblique-and-wide",
    domain: "prepare-one",
    comparisonGroup: "P2",
    black: "E10 G5",
    white: "D11 C3",
    candidate: "G8",
    reply: "K10",
    focus: "E10 G5",
    arms: ["E10 G8", "G5 G8"],
    outcome: "one",
    objective: "open-three",
    cells: "G8",
    guide: "G7 G6",
  },
  {
    id: "check-prepare-v5-near-and-wide-two",
    role: "assessment",
    unitId: "prepare",
    family: "prepare/near-and-wide",
    domain: "prepare-two",
    comparisonGroup: "P3",
    black: "F6 H9",
    white: "C11 L2",
    candidate: "H6",
    reply: "K13",
    focus: "F6 H9",
    arms: ["F6 H6", "H6 H9"],
    outcome: "two",
    objective: "open-three",
    cells: "H6",
    guide: "H8 H7 E6 G6 I6",
  },
  {
    id: "check-prepare-v5-near-and-wide-one",
    role: "assessment",
    unitId: "prepare",
    family: "prepare/near-and-wide",
    domain: "prepare-one",
    comparisonGroup: "P3",
    black: "F6 H9",
    white: "I6 L2",
    candidate: "H6",
    reply: "K13",
    focus: "F6 H9",
    arms: ["F6 H6", "H6 H9"],
    outcome: "one",
    objective: "open-three",
    cells: "H6",
    guide: "H8 H7",
  },
  {
    id: "practice-prepare-v5-adjacent-elbow-remedial-two",
    role: "lesson",
    unitId: "prepare",
    family: "prepare/adjacent-elbow-remedial",
    domain: "prepare-two",
    comparisonGroup: "PL",
    black: "F10 G9",
    white: "B3 M12",
    candidate: "G10",
    reply: "K5",
    focus: "F10 G9",
    arms: ["F10 G10", "G9 G10"],
    outcome: "two",
    objective: "open-three",
    cells: "G10",
    guide: "G12 G11 D10 E10 H10 I10 G8 G7",
  },
  {
    id: "practice-prepare-v5-adjacent-elbow-remedial-one",
    role: "lesson",
    unitId: "prepare",
    family: "prepare/adjacent-elbow-remedial",
    domain: "prepare-one",
    comparisonGroup: "PL",
    black: "F10 G9",
    white: "E10 M12",
    candidate: "G10",
    reply: "K5",
    focus: "F10 G9",
    arms: ["F10 G10", "G9 G10"],
    outcome: "one",
    objective: "open-three",
    cells: "G10",
    guide: "G12 G11 G8 G7",
  },
  {
    id: "check-opening-v5-orthogonal-gap-near",
    role: "assessment",
    unitId: "opening",
    family: "opening/orthogonal-gap",
    domain: "opening-near-blocked",
    comparisonGroup: "O1",
    black: "F7 H9",
    white: "F8 L3",
    candidate: "F9",
    reply: "K11",
    focus: "F7 H9",
    arms: [],
    outcome: "no",
    objective: "two-directions",
    cells: "F7 H9",
    guide: "D9 H7 J7 H5",
  },
  {
    id: "check-opening-v5-orthogonal-gap-far",
    role: "assessment",
    unitId: "opening",
    family: "opening/orthogonal-gap",
    domain: "opening-far-ready",
    comparisonGroup: "O1",
    black: "F7 H9",
    white: "L5 L3",
    candidate: "F9",
    reply: "K11",
    focus: "F7 H9",
    arms: [],
    outcome: "yes",
    objective: "two-directions",
    cells: "F7 H9",
    guide: "F11 D9 H7 J7 H5",
  },
  {
    id: "check-opening-v5-oblique-bridge-near",
    role: "assessment",
    unitId: "opening",
    family: "opening/oblique-bridge",
    domain: "opening-near-blocked",
    comparisonGroup: "O2",
    black: "E9 I9",
    white: "F10 M3",
    candidate: "G11",
    reply: "K6",
    focus: "E9 I9",
    arms: [],
    outcome: "no",
    objective: "two-directions",
    cells: "E9 I9",
    guide: "E13 G7 E5 I5",
  },
  {
    id: "check-opening-v5-oblique-bridge-far",
    role: "assessment",
    unitId: "opening",
    family: "opening/oblique-bridge",
    domain: "opening-far-ready",
    comparisonGroup: "O2",
    black: "E9 I9",
    white: "B4 M3",
    candidate: "G11",
    reply: "K6",
    focus: "E9 I9",
    arms: [],
    outcome: "yes",
    objective: "two-directions",
    cells: "E9 I9",
    guide: "E13 I13 G7 E5 I5",
  },
  {
    id: "check-opening-v5-bounded-row-room-near",
    role: "assessment",
    unitId: "opening",
    family: "opening/bounded-row-room",
    domain: "opening-near-ready",
    comparisonGroup: "O3",
    black: "F8 H6",
    white: "G7 J8",
    candidate: "H8",
    reply: "L12",
    focus: "F8 H6",
    arms: [],
    outcome: "yes",
    objective: "two-directions",
    cells: "F8 H6",
    guide: "H10 D6 F6 F4",
  },
  {
    id: "check-opening-v5-bounded-row-room-far",
    role: "assessment",
    unitId: "opening",
    family: "opening/bounded-row-room",
    domain: "opening-far-blocked",
    comparisonGroup: "O3",
    black: "F8 H6",
    white: "E8 J8",
    candidate: "H8",
    reply: "L12",
    focus: "F8 H6",
    arms: [],
    outcome: "no",
    objective: "two-directions",
    cells: "F8 H6",
    guide: "H10 D6 F6 F4",
  },
  {
    id: "practice-opening-v5-near-clear-remedial-near",
    role: "lesson",
    unitId: "opening",
    family: "opening/near-clear-remedial",
    domain: "opening-near-ready",
    comparisonGroup: "OLn",
    black: "E8 H8",
    white: "D10 L3",
    candidate: "E11",
    reply: "M12",
    focus: "E8 H8",
    arms: [],
    outcome: "yes",
    objective: "two-directions",
    cells: "E8 H8",
    guide: "H11 E5 H5",
  },
  {
    id: "practice-opening-v5-wide-offset-remedial-far",
    role: "lesson",
    unitId: "opening",
    family: "opening/wide-offset-remedial",
    domain: "opening-far-ready",
    comparisonGroup: "OLf",
    black: "F5 I9",
    white: "B13 M2",
    candidate: "F9",
    reply: "L12",
    focus: "F5 I9",
    arms: [],
    outcome: "yes",
    objective: "two-directions",
    cells: "F5 I9",
    guide: "J9 I8 F6 E5 I5",
  },
  {
    id: "check-practice-v5-straight-race-win",
    role: "assessment",
    unitId: "practice",
    family: "practice/straight-race",
    domain: "practical-win",
    comparisonGroup: "T1",
    black: "D10 F10 G10 H10",
    white: "J5 J6 J7 J8",
    candidate: "",
    reply: "",
    focus: "D10 F10 G10 H10",
    arms: [],
    outcome: "win",
    objective: "five",
    cells: "",
    guide: "E10",
  },
  {
    id: "check-practice-v5-oblique-race-win",
    role: "assessment",
    unitId: "practice",
    family: "practice/oblique-race",
    domain: "practical-win",
    comparisonGroup: "T2",
    black: "F11 G10 H9 J7",
    white: "C4 D4 E4 F4",
    candidate: "",
    reply: "",
    focus: "F11 G10 H9 J7",
    arms: [],
    outcome: "win",
    objective: "five",
    cells: "",
    guide: "I8",
  },
  {
    id: "check-practice-v5-closed-line-defense-defense",
    role: "assessment",
    unitId: "practice",
    family: "practice/closed-line-defense",
    domain: "practical-defense",
    comparisonGroup: "T3",
    black: "E10 G8 I6 L12",
    white: "F10 G10 H10 I10",
    candidate: "",
    reply: "",
    focus: "E10 G8 I6 L12",
    arms: [],
    outcome: "defense",
    objective: "prevent-fork",
    cells: "",
    guide: "J10",
  },
  {
    id: "check-practice-v5-pre-fork-defense-defense",
    role: "assessment",
    unitId: "practice",
    family: "practice/pre-fork-defense",
    domain: "practical-defense",
    comparisonGroup: "T4",
    black: "B3 K7 M13",
    white: "E11 F11 H11",
    candidate: "",
    reply: "",
    focus: "B3 K7 M13",
    arms: [],
    outcome: "defense",
    objective: "prevent-fork",
    cells: "",
    guide: "D11 G11 I11",
  },
  {
    id: "check-practice-v5-wide-horizontal-rebuild-build",
    role: "assessment",
    unitId: "practice",
    family: "practice/wide-horizontal-rebuild",
    domain: "practical-build",
    comparisonGroup: "T5",
    black: "D8 G8 I5",
    white: "F11 K7 M3",
    candidate: "",
    reply: "",
    focus: "D8 G8 I5",
    arms: [],
    outcome: "build",
    objective: "two-directions",
    cells: "D8 G8",
    guide: "D11 G11 D5 G5",
  },
  {
    id: "check-practice-v5-oblique-rebuild-build",
    role: "assessment",
    unitId: "practice",
    family: "practice/oblique-rebuild",
    domain: "practical-build",
    comparisonGroup: "T6",
    black: "E11 H8 J8",
    white: "C6 I12 M5",
    candidate: "",
    reply: "",
    focus: "E11 H8 J8",
    arms: [],
    outcome: "build",
    objective: "two-directions",
    cells: "E11 H8",
    guide: "H11 E8",
  },
  {
    id: "practice-practice-v5-middle-gap-race-remedial-win",
    role: "lesson",
    unitId: "practice",
    family: "practice/middle-gap-race-remedial",
    domain: "practical-win",
    comparisonGroup: "TLw",
    black: "D6 E7 G9 H10",
    white: "J4 K4 L4 M4",
    candidate: "",
    reply: "",
    focus: "D6 E7 G9 H10",
    arms: [],
    outcome: "win",
    objective: "five",
    cells: "",
    guide: "F8",
  },
  {
    id: "practice-practice-v5-oblique-gap-remedial-defense",
    role: "lesson",
    unitId: "practice",
    family: "practice/oblique-gap-remedial",
    domain: "practical-defense",
    comparisonGroup: "TLd",
    black: "C3 D11 K5 M13",
    white: "F6 G7 I9 J10",
    candidate: "",
    reply: "",
    focus: "C3 D11 K5 M13",
    arms: [],
    outcome: "defense",
    objective: "prevent-fork",
    cells: "",
    guide: "H8",
  },
  {
    id: "practice-practice-v5-oblique-pre-fork-remedial-defense",
    role: "lesson",
    unitId: "practice",
    family: "practice/oblique-pre-fork-remedial",
    domain: "practical-defense",
    comparisonGroup: "TLf",
    black: "C12 K4 M11",
    white: "E6 G8 H9",
    candidate: "",
    reply: "",
    focus: "C12 K4 M11",
    arms: [],
    outcome: "defense",
    objective: "prevent-fork",
    cells: "",
    guide: "I10 F7 D5",
  },
  {
    id: "practice-practice-v5-unequal-offset-remedial-build",
    role: "lesson",
    unitId: "practice",
    family: "practice/unequal-offset-remedial",
    domain: "practical-build",
    comparisonGroup: "TLq",
    black: "F6 H10 J7",
    white: "C11 E3 M12",
    candidate: "",
    reply: "",
    focus: "F6 H10 J7",
    arms: [],
    outcome: "build",
    objective: "two-directions",
    cells: "F6 H10",
    guide: "F10 J10 I9 F8 H8 E7 D6 H6",
  },
  {
    id: "check-opening-v5-wide-orthogonal-block-near",
    role: "assessment",
    unitId: "opening",
    family: "opening/wide-orthogonal-block",
    domain: "opening-near-ready",
    comparisonGroup: "O4",
    black: "D9 G6",
    white: "H8 L4",
    candidate: "G9",
    reply: "K12",
    focus: "D9 G6",
    arms: [],
    outcome: "yes",
    objective: "two-directions",
    cells: "D9 G6",
    guide: "D6",
  },
  {
    id: "check-opening-v5-wide-orthogonal-block-far",
    role: "assessment",
    unitId: "opening",
    family: "opening/wide-orthogonal-block",
    domain: "opening-far-blocked",
    comparisonGroup: "O4",
    black: "D9 G6",
    white: "E9 L4",
    candidate: "G9",
    reply: "K12",
    focus: "D9 G6",
    arms: [],
    outcome: "no",
    objective: "two-directions",
    cells: "D9 G6",
    guide: "D6",
  },
  {
    id: "practice-opening-v5-near-interior-remedial-near",
    role: "lesson",
    unitId: "opening",
    family: "opening/near-interior-remedial",
    domain: "opening-near-blocked",
    comparisonGroup: "OLnb",
    black: "E5 G8",
    white: "E7 M12",
    candidate: "E8",
    reply: "K4",
    focus: "E5 G8",
    arms: [],
    outcome: "no",
    objective: "two-directions",
    cells: "E5 G8",
    guide: "H8 G7 E6 D5 G5",
  },
  {
    id: "practice-opening-v5-far-interior-remedial-far",
    role: "lesson",
    unitId: "opening",
    family: "opening/far-interior-remedial",
    domain: "opening-far-blocked",
    comparisonGroup: "OLfb",
    black: "B11 F9",
    white: "D11 N4",
    candidate: "F11",
    reply: "L13",
    focus: "B11 F9",
    arms: [],
    outcome: "no",
    objective: "two-directions",
    cells: "B11 F9",
    guide: "B9 D9 E8 F7",
  },
];

const choicesByUnit = {
  branch: [
    ["yes", "作れる"],
    ["no", "作れない"],
  ],
  prepare: [
    ["two", "2方向"],
    ["one", "1方向"],
    ["none", "なし"],
  ],
  opening: [
    ["yes", "つながる"],
    ["no", "つながらない"],
  ],
  practice: [
    ["win", "今すぐ五連"],
    ["defense", "白の狙いを消す"],
    ["build", "配置をつなぐ"],
  ],
};
const names = (cells) => cells.map(coord).join("・");
const axes = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];
const axisNames = ["横", "縦", "右下がりの斜め", "右上がりの斜め"];
const windows = [],
  sixes = [];
for (let y = 0; y < 15; y++)
  for (let x = 0; x < 15; x++)
    for (const [axis, [dx, dy]] of axes.entries())
      for (const length of [5, 6]) {
        const ex = x + dx * (length - 1),
          ey = y + dy * (length - 1);
        if (ex < 0 || ex >= 15 || ey < 0 || ey >= 15) continue;
        (length === 5 ? windows : sixes).push({
          axis,
          cells: Array.from(
            { length },
            (_, k) => (y + dy * k) * 15 + x + dx * k,
          ),
        });
      }
const unique = (values) => [...new Set(values)].sort((a, b) => a - b);
const withStone = (board, i, side) => {
  const after = [...board];
  after[i] = side;
  return after;
};
const mark = (cells = [], points = [], tone = "focus") => ({
  cells: unique(cells),
  points: unique(points),
  tone,
});
function axisBetween(a, b) {
  const dx = (b % 15) - (a % 15),
    dy = Math.floor(b / 15) - Math.floor(a / 15);
  return axes.findIndex(([x, y]) => dx * y === dy * x);
}
function wholeLine(point, axis) {
  const [dx, dy] = axes[axis];
  let x = point % 15,
    y = Math.floor(point / 15);
  while (x - dx >= 0 && x - dx < 15 && y - dy >= 0 && y - dy < 15) {
    x -= dx;
    y -= dy;
  }
  const line = [];
  while (x >= 0 && x < 15 && y >= 0 && y < 15) {
    line.push(y * 15 + x);
    x += dx;
    y += dy;
  }
  return line;
}
function connectionArms(board, origin, supports) {
  return supports.map((support) => {
    const axis = axisBetween(origin, support),
      line = wholeLine(origin, axis);
    const a = line.indexOf(origin),
      b = line.indexOf(support);
    const between = line
      .slice(Math.min(a, b) + 1, Math.max(a, b))
      .filter((i) => board[i] === 2);
    let left = a,
      right = a;
    while (left > 0 && board[line[left - 1]] !== 2) left--;
    while (right + 1 < line.length && board[line[right + 1]] !== 2) right++;
    const segment = line.slice(left, right + 1),
      window =
        windows.find(
          (w) =>
            w.axis === axis &&
            w.cells.includes(origin) &&
            w.cells.includes(support) &&
            w.cells.every((i) => board[i] !== 2),
        )?.cells || [],
      blockers = between.length
        ? between
        : window.length
          ? []
          : [line[left - 1], line[right + 1]].filter(
              (i) => i !== undefined && board[i] === 2,
            );
    return { support, axis, between, blockers, segment, window };
  });
}
function connectionText(origin, arms) {
  const blocked = arms.filter((arm) => !arm.window.length);
  if (blocked.length)
    return blocked
      .map((arm) =>
        arm.between.length
          ? `黒${coord(origin)}から${coord(arm.support)}への${axisNames[arm.axis]}は、途中の白${names(arm.between)}で切れる。`
          : `${arm.blockers.length ? `白${names(arm.blockers)}に挟まれ、` : "盤端まで数えても、"}${axisNames[arm.axis]}は${coord(arm.segment[0])}〜${coord(arm.segment.at(-1))}の${arm.segment.length}点。${coord(arm.support)}へつなぐ5点の余地がない。`,
      )
      .join("");
  return `黒${coord(origin)}から、${arms.map((arm) => `${coord(arm.support)}へ${axisNames[arm.axis]}（${coord(arm.window[0])}〜${coord(arm.window.at(-1))}の5点）`).join("、")}につながる。`;
}
function winningStones(board, side, completions) {
  return unique(
    windows
      .filter(
        ({ cells }) =>
          cells.some((i) => completions.includes(i)) &&
          cells.filter((i) => board[i] === side).length === 4 &&
          cells.every((i) => board[i] !== 3 - side),
      )
      .flatMap(({ cells }) => cells.filter((i) => board[i] === side)),
  );
}
function forkFacts(board, side) {
  const candidates = unique(
    windows
      .filter(
        ({ cells }) =>
          cells.filter((i) => board[i] === side).length === 3 &&
          cells.every((i) => board[i] !== 3 - side),
      )
      .flatMap(({ cells }) => cells.filter((i) => !board[i])),
  );
  return candidates.flatMap((move) => {
    const after = withStone(board, move, side),
      completions = completionPoints(after, side);
    return completions.length >= 2 && !completionPoints(after, 3 - side).length
      ? [{ move, completions, stones: winningStones(after, side, completions) }]
      : [];
  });
}
function exerciseTitle(spec, cells) {
  if (spec.objective === "five") return "五連にする";
  if (spec.objective === "prevent-fork")
    return "白の即五連と次の二重攻撃を消す";
  if (spec.objective === "open-four") return `${names(cells)}から完成点を2つ`;
  if (spec.objective === "open-three")
    return `${names(cells)}を使い、両端四につながる三`;
  return `${names(cells)}へ2方向でつなぐ`;
}
function explanation(spec, board) {
  const supports = points(spec.focus),
    candidate = spec.candidate ? parse(spec.candidate) : null;
  if (spec.unitId === "branch") {
    const axis = axisBetween(supports[0], supports[1]),
      supportLine = wholeLine(supports[0], axis),
      move = exerciseMoves(board, { objective: "four", cells: supports }).find(
        (i) => {
          const locations = [...supports, i].map((cell) =>
            supportLine.indexOf(cell),
          );
          return Math.max(...locations) - Math.min(...locations) === 3;
        },
      ),
      after = withStone(board, move, 1),
      completions = completionPoints(after, 1),
      line = wholeLine(move, axis),
      index = line.indexOf(move);
    let left = index,
      right = index;
    while (left > 0 && after[line[left - 1]] === 1) left--;
    while (right + 1 < line.length && after[line[right + 1]] === 1) right++;
    const four = line.slice(left, right + 1),
      blockers = [line[left - 1], line[right + 1]].filter(
        (i) => i !== undefined && board[i] === 2,
      ),
      text =
        completions.length >= 2
          ? `黒${coord(move)}なら${names(four)}の四。完成点は${names(completions)}の${completions.length}か所。`
          : `黒${coord(move)}で四にしても、外側の白${names(blockers)}により完成点は${names(completions)}の${completions.length}か所だけ。`;
    return {
      text,
      reason: {
        kind: "four-after-followup",
        move,
        four,
        completions,
        blockers,
        axis,
      },
      highlights: [
        mark(supports, [move]),
        mark([], completions, "good"),
        ...(blockers.length ? [mark(blockers, [], "danger")] : []),
      ],
    };
  }
  if (spec.unitId === "prepare") {
    const arms = spec.arms.map((labels) => {
      const cells = points(labels),
        axis = axisBetween(cells[0], cells[1]),
        moves = exerciseMoves(board, { objective: "open-three", cells }),
        possible = sixes.filter((w) =>
          cells.every((i) => w.cells.slice(1, 5).includes(i)),
        ),
        blockers = moves.length
          ? []
          : unique(
              possible.flatMap((w) => w.cells.filter((i) => board[i] === 2)),
            );
      return { cells, axis, moves, blockers };
    });
    const text = arms
      .map((arm) =>
        arm.moves.length
          ? `${axisNames[arm.axis]}の${names(arm.cells)}は、黒${names(arm.moves)}で両端四につながる三を作れる。`
          : `${axisNames[arm.axis]}の${names(arm.cells)}は、${arm.blockers.length ? `外側の白${names(arm.blockers)}` : "盤端"}で両端の余地が足りず、その三を作れない。`,
      )
      .join("");
    return {
      text,
      reason: { kind: "followup-arms", arms },
      highlights: [
        mark(
          unique(arms.flatMap((arm) => arm.cells)),
          arms.flatMap((arm) => arm.moves),
        ),
        ...arms
          .filter((arm) => arm.blockers.length)
          .map((arm) => mark(arm.blockers, [], "danger")),
      ],
    };
  }
  if (spec.unitId === "opening") {
    const arms = connectionArms(board, candidate, supports),
      blockers = unique(arms.flatMap((arm) => arm.blockers));
    return {
      text: connectionText(candidate, arms),
      reason: { kind: "connection", origin: candidate, arms },
      highlights: [
        mark([...supports, candidate]),
        ...(blockers.length ? [mark(blockers, [], "danger")] : []),
      ],
    };
  }
  const own = completionPoints(board, 1),
    white = completionPoints(board, 2);
  if (own.length) {
    const stones = winningStones(board, 1, own),
      whiteStones = winningStones(board, 2, white);
    return {
      text: `黒${names(own)}で五連。${white.length ? `白にも${names(white)}の完成点があるが、` : ""}黒が先に完成して終わる。`,
      reason: {
        kind: "immediate-win",
        points: own,
        stones,
        whitePoints: white,
        whiteStones,
      },
      highlights: [
        mark(stones, own, "good"),
        ...(white.length ? [mark(whiteStones, white, "danger")] : []),
      ],
    };
  }
  if (white.length) {
    const stones = winningStones(board, 2, white),
      defenses = exerciseMoves(board, { objective: "prevent-fork", cells: [] });
    return {
      text: `白の完成点は${names(white)}。黒${names(defenses)}で止めると、白の即五連と次の二重攻撃が消える。`,
      reason: { kind: "immediate-defense", points: white, stones, defenses },
      highlights: [mark(stones, white, "danger")],
    };
  }
  const threats = forkFacts(board, 2);
  if (threats.length) {
    const defenses = exerciseMoves(board, {
        objective: "prevent-fork",
        cells: [],
      }),
      text =
        threats
          .map(
            (threat) =>
              `白${coord(threat.move)}で四ができ、${names(threat.completions)}が完成点になる。`,
          )
          .join("") +
        `黒${names(defenses)}のいずれかで、その二重攻撃を消せる。`;
    return {
      text,
      reason: { kind: "pre-fork-defense", threats, defenses },
      highlights: [
        mark(
          threats
            .flatMap((threat) => threat.stones)
            .filter((i) => board[i] === 2),
          threats.flatMap((threat) => [threat.move, ...threat.completions]),
          "danger",
        ),
      ],
    };
  }
  const cells = points(spec.cells),
    move = exerciseMoves(board, { objective: "two-directions", cells })[0],
    arms = connectionArms(withStone(board, move, 1), move, cells);
  return {
    text: `今の即五連点と白の次の二重攻撃はない。例えば${connectionText(move, arms)}`,
    reason: { kind: "quiet-connection", move, arms },
    highlights: [mark(cells, [move])],
  };
}
function makeProblem(spec) {
  const board = makeBoard(spec.black, spec.white),
    candidate = spec.candidate ? parse(spec.candidate) : null,
    reply = spec.reply ? parse(spec.reply) : null,
    focus = points(spec.focus),
    cells = points(spec.cells),
    moves =
      candidate === null
        ? []
        : [
            { i: candidate, side: 1 },
            { i: reply, side: 2 },
          ],
    continuation = {
      moves,
      cells,
      objective: spec.objective,
      title: exerciseTitle(spec, cells),
    },
    after = [...board],
    frames = [];
  for (const move of moves) {
    if (after[move.i]) throw Error(`局面比較の指定手順が重複: ${spec.id}`);
    after[move.i] = move.side;
    // These are the exact frames used while applying the authored prefix.
    // Neither the next empty point nor a successful continuation is shown.
    frames.push({
      board: [...after],
      last: move.i,
      title: `${move.side === 1 ? "黒" : "白"}${coord(move.i)}`,
      text: "",
      highlights: [{ cells: [move.i], points: [], tone: "focus" }],
    });
  }
  const causal = explanation(spec, after),
    text = causal.text,
    resultTitle = choicesByUnit[spec.unitId].find(
      ([id]) => id === spec.outcome,
    )[1];
  // last:null keeps the explanatory frame out of prefix frame matching.
  // It is available after an incorrect prediction or the learner's own move.
  frames.push({
    board: [...after],
    last: null,
    title: resultTitle,
    text,
    highlights: causal.highlights,
  });
  const prefix =
      candidate === null ? "" : `黒${spec.candidate}→白${spec.reply}の後、`,
    goal =
      spec.unitId === "branch"
        ? `${prefix}${names(focus)}から完成点を2つ作れる？`
        : spec.unitId === "prepare"
          ? `${prefix}${spec.candidate}を使う活三は何方向に作れる？`
          : spec.unitId === "opening"
            ? `${prefix}印の黒手は2方向へつながる？`
            : "次の一手を選ぶ",
    given =
      spec.unitId === "practice" ? [] : focus.filter((i) => board[i] === 1),
    questionHighlights =
      candidate === null
        ? []
        : [{ cells: given, points: [candidate], tone: "focus" }];
  return {
    id: spec.id,
    role: spec.role,
    unitId: spec.unitId,
    skillId: spec.unitId,
    family: spec.family,
    branchId: `${spec.comparisonGroup}-${spec.outcome}`,
    requiresBranch: false,
    ...(spec.role === "assessment"
      ? { assessmentDomain: spec.domain }
      : { teachesAssessmentDomain: spec.domain }),
    title: spec.unitId === "practice" ? "局面を読む" : "続きを考える",
    goal,
    kind: "compare",
    goalKind: "compare-plan",
    completion: "local-goal",
    board,
    sideToMove: 1,
    rootNodeId: "start",
    questionHighlights,
    hintTexts:
      spec.unitId === "practice"
        ? [
            "黒が今五連にできる点を探す。",
            "白の即五連と、次に二つの完成点を作る手を確かめる。",
            "検査した脅威がなければ、黒石につながる配置を比べる。",
          ]
        : [
            "指定した黒手と白手を順に置いた形を考える。",
            "白石と盤端で区切られた線の長さを見る。",
            "設問で指定した石を使い、空点と方向を数える。",
          ],
    hintStages: [questionHighlights, questionHighlights, questionHighlights],
    prediction: {
      kind: {
        branch: "remaining-open-four",
        prepare: "followup-directions",
        opening: "connection",
        practice: "priority",
      }[spec.unitId],
      candidate,
      reply,
      support: focus,
      arms: spec.arms.map(points),
      outcome: spec.outcome,
      comparisonGroup: `${spec.role}/${spec.unitId}/${spec.comparisonGroup}`,
      reason: causal.reason,
      ...(spec.unitId === "opening"
        ? { whiteDistance: spec.domain.split("-")[1] }
        : {}),
    },
    guide: points(spec.guide),
    judge: { kind: "compare" },
    nodes: [
      {
        id: "start",
        input: "choice",
        hints: [],
        choices: choicesByUnit[spec.unitId].map(([id, title]) => ({
          id,
          title,
          correct: id === spec.outcome,
          resultTitle,
          text,
          frames,
          ...(id === spec.outcome ? { continuations: [continuation] } : {}),
        })),
      },
    ],
    evidence: {
      source: "original",
      sourceId: null,
      scope:
        "指定手順後の有限な形・連結・即勝ち・次の二重攻撃と、本人の合法な続きだけを検査する。全局最善や長い勝ち筋の不存在は判定しない。",
      verification:
        "tests/assessment-positions-v5.test.mjs; independent five/six-cell windows; freestyle15, >=5",
    },
  };
}

export const positionAssessments = freeze(
  definitions.filter((spec) => spec.role === "assessment").map(makeProblem),
);
export const positionPracticeLessons = freeze(
  definitions.filter((spec) => spec.role === "lesson").map(makeProblem),
);
export const positionProblemsV5 = freeze([
  ...positionAssessments,
  ...positionPracticeLessons,
]);
