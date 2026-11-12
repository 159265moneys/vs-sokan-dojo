import { parse, coord } from "./game.js";

const points = (text = "") => text.split(/\s+/).filter(Boolean).map(parse);
const makeBoard = (black, white) => {
  const board = Array(225).fill(0);
  for (const [text, side] of [
    [black, 1],
    [white, 2],
  ])
    for (const i of points(text)) {
      if (board[i]) throw Error(`条件盤の重複: ${coord(i)}`);
      board[i] = side;
    }
  return board;
};
const freeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

// These questions predict a specified move, not a unique best move or a win.
// Expected facts are authored explicitly and checked by an independent window
// enumerator in tests/assessment-conditions-v5.test.mjs.
function question(spec, ordinal, role = "assessment") {
  const board = makeBoard(spec.black, spec.white);
  const move = parse(spec.move);
  const completionPoints = points(spec.completions);
  const positive = completionPoints.length >= 2;
  const kind = spec.question || "completion-count";
  const after = [...board];
  after[move] = 1;
  const countTitle = ["完成点はゼロ", "完成点は一つ", "完成点は二つ"][
    completionPoints.length
  ];
  const resultTitle =
    kind === "open-four"
      ? positive
        ? "両端四になる"
        : "両端四にはならない"
      : countTitle;
  const highlights = [
    { cells: points(spec.focus), points: [], tone: "focus" },
    { cells: [], points: completionPoints, tone: "good" },
    ...(spec.blockers
      ? [{ cells: points(spec.blockers), points: [], tone: "danger" }]
      : []),
  ];
  const frame = {
    board: after,
    last: move,
    title: resultTitle,
    text: spec.explanation,
    highlights,
  };
  const choices =
    kind === "open-four"
      ? [
          { id: "yes", title: "両端四になる", value: true },
          { id: "no", title: "両端四にならない", value: false },
        ]
      : [
          { id: "zero", title: "0か所", value: 0 },
          { id: "one", title: "1か所", value: 1 },
          { id: "two", title: "2か所", value: 2 },
        ];
  return {
    id: `${role === "assessment" ? "check" : "practice"}-conditions-${String(ordinal).padStart(2, "0")}`,
    role,
    unitId: "conditions",
    skillId: "conditions",
    family: `conditions/${spec.family}`,
    branchId: spec.group,
    requiresBranch: false,
    ...(role === "assessment"
      ? {
          assessmentDomain: positive
            ? "conditions-positive"
            : "conditions-negative",
        }
      : {
          teachesAssessmentDomain: positive
            ? "conditions-positive"
            : "conditions-negative",
        }),
    title: role === "assessment" ? "形を確かめる" : `形の条件 ${ordinal}`,
    goal:
      kind === "open-four"
        ? `${spec.move}に黒を置くと、両端四になる？`
        : `${spec.move}に黒を置くと、完成点はいくつ？`,
    kind: "compare",
    goalKind: "compare-plan",
    completion: "comparison",
    board,
    sideToMove: 1,
    rootNodeId: "start",
    guide: [],
    judge: { kind: "compare" },
    questionHighlights: [{ cells: [], points: [move], tone: "focus" }],
    hintTexts: [
      "候補に黒を置いた形を見る。",
      "五つ並ぶ空点と、その外側を数える。",
      "同じ空点は、一か所として数える。",
    ],
    hintStages: [
      [
        {
          cells: points(spec.focus).filter((i) => board[i]),
          points: [move],
          tone: "focus",
        },
      ],
      [
        {
          cells: [
            ...points(spec.focus).filter((i) => board[i]),
            ...points(spec.blockers),
          ],
          points: [move],
          tone: "focus",
        },
      ],
      [
        {
          cells: points(spec.focus).filter((i) => board[i]),
          points: completionPoints,
          tone: "good",
        },
      ],
    ],
    nodes: [
      {
        id: "start",
        input: "choice",
        hints: [],
        choices: choices.map((choice) => ({
          id: choice.id,
          title: choice.title,
          correct:
            choice.value ===
            (kind === "open-four" ? positive : completionPoints.length),
          resultTitle,
          text: spec.explanation,
          frames: [frame],
        })),
      },
    ],
    prediction: {
      kind,
      move,
      completionPoints,
      focusCells: points(spec.focus),
      blockers: points(spec.blockers),
      boundary: spec.boundary || null,
      comparisonGroup: spec.group,
    },
    evidence: {
      source: "original",
      sourceId: null,
      scope:
        "指定した黒一手後の完成点と両端四を比較する自作盤。勝ちや唯一最善手の認定はしない。",
      verification:
        "tests/assessment-conditions-v5.test.mjs / independent five- and six-cell windows / freestyle15 >=5",
    },
  };
}

const assessmentSpecs = [
  {
    family: "outer-space",
    group: "outer-horizontal",
    question: "open-four",
    black: "F7 G7 H7 C12 L3",
    white: "D7 J7 B3 K12 N5",
    move: "E7",
    focus: "E7 F7 G7 H7",
    completions: "I7",
    blockers: "D7 J7",
    explanation:
      "E7の後はD7が白なので、完成点はI7だけ。反対側のI7へ延ばしてもJ7の白で止まる。",
  },
  {
    family: "outer-space",
    group: "outer-horizontal",
    question: "open-four",
    black: "F7 G7 H7 C12 L3",
    white: "D12 J7 B3 K12 N5",
    move: "E7",
    focus: "E7 F7 G7 H7",
    completions: "D7 I7",
    blockers: "J7",
    explanation:
      "E7の後はD7とI7が空いている。どちらでも五連になり、J7の白はI7への完成を止めない。",
  },
  {
    family: "outer-space",
    group: "outer-diagonal",
    black: "D11 E10 F9 L12 C3",
    white: "B13 J12 B5 L3 N7",
    move: "G8",
    focus: "D11 E10 F9 G8",
    completions: "C12 H7",
    blockers: "B13",
    explanation:
      "G8の後はC12とH7の二か所で斜めの五連になる。B13の白はC12への完成を止めない。",
  },
  {
    family: "outer-space",
    group: "outer-diagonal",
    black: "D11 E10 F9 L12 C3",
    white: "B13 H7 B5 L3 N7",
    move: "G8",
    focus: "D11 E10 F9 G8",
    completions: "C12",
    blockers: "B13 H7",
    explanation:
      "G8の後はH7が白なので、完成点はC12だけ。先にC12へ延ばしても、外側のB13が白なので両端四にはならない。",
  },
  {
    family: "board-edge",
    group: "edge-horizontal",
    black: "C11 E11 F11 J4 M8",
    white: "B4 D3 G2 K13 N6",
    move: "D11",
    focus: "C11 D11 E11 F11",
    completions: "B11 G11",
    explanation:
      "D11の後はC11からF11まで四つ並ぶ。両端のB11とG11は盤内の空点で、完成点は二か所。",
  },
  {
    family: "board-edge",
    group: "edge-horizontal",
    black: "A11 B11 C11 J4 M8",
    white: "B4 D3 G2 K13 N6",
    move: "D11",
    focus: "A11 B11 C11 D11",
    completions: "E11",
    boundary: { anchor: "A11", outward: [-1, 0] },
    explanation:
      "D11の後はA11からD11まで四つ並ぶ。A11の左は盤外なので、完成点はE11だけ。",
  },
  {
    family: "board-edge",
    group: "edge-diagonal",
    black: "A15 C13 D12 H4 K9",
    white: "A3 C5 E7 J13 N2",
    move: "B14",
    focus: "A15 B14 C13 D12",
    completions: "E11",
    boundary: { anchor: "A15", outward: [-1, -1] },
    explanation:
      "B14の後はA15からD12まで斜めに四つ並ぶ。A15の外側は盤外なので、完成点はE11だけ。",
  },
  {
    family: "board-edge",
    group: "edge-diagonal",
    black: "C13 D12 E11 H4 K9",
    white: "A3 C5 E7 J13 N2",
    move: "B14",
    focus: "B14 C13 D12 E11",
    completions: "A15 F10",
    explanation:
      "B14の後はA15とF10が完成点。A15は盤端にあっても置ける空点なので、二か所とも数える。",
  },
  {
    family: "gapped-three",
    group: "gap-horizontal",
    question: "open-four",
    black: "F4 H4 I4 C11 L9",
    white: "A6 D13 K2 N7 B9",
    move: "G4",
    focus: "F4 G4 H4 I4",
    completions: "E4 J4",
    explanation:
      "G4で間を埋めるとF4からI4まで四つ並ぶ。E4とJ4が空いているので両端四になる。",
  },
  {
    family: "gapped-three",
    group: "gap-horizontal",
    question: "open-four",
    black: "F4 H4 I4 C11 L9",
    white: "A6 D13 J4 N7 B9",
    move: "G4",
    focus: "F4 G4 H4 I4",
    completions: "E4",
    blockers: "J4",
    explanation:
      "G4で間を埋めてもJ4が白で、完成点はE4だけ。三つの黒と空点の並びだけでは両端四を作れるとは決まらない。",
  },
  {
    family: "shared-completion",
    group: "shared-gap",
    black: "F8 I8 J8 K8 C3 K12 B10",
    white: "A2 D12 J3 L7 N13 C6 M10",
    move: "G8",
    focus: "F8 G8 I8 J8 K8",
    completions: "H8",
    explanation:
      "F8からJ8の五マスも、G8からK8の五マスも、足りないのはH8。同じ空点なので完成点は一か所。",
  },
  {
    family: "shared-completion",
    group: "shared-gap",
    black: "E8 F8 I8 G6 G7 G10 L12",
    white: "A2 D12 J3 L7 N13 C6 M10",
    move: "G8",
    focus: "E8 F8 G8 I8 G6 G7 G10",
    completions: "H8 G9",
    explanation:
      "横のE8からI8はH8、縦のG6からG10はG9で五連になる。異なる空点なので完成点は二か所。",
  },
];

const practiceSpecs = [
  {
    family: "outer-space",
    group: "practice-outer",
    question: "open-four",
    black: "F10 G10 H10 J3 B5",
    white: "D10 J10 K5 C13 N8",
    move: "E10",
    focus: "E10 F10 G10 H10",
    completions: "I10",
    blockers: "D10 J10",
    explanation:
      "E10の後はD10が白なので完成点はI10だけ。I10へ延ばす場合も、その外側のJ10が白で両端四にはならない。",
  },
  {
    family: "board-edge",
    group: "practice-edge",
    black: "M13 M11 M10 C7 J5",
    white: "A4 D10 G6 K12 N2",
    move: "M12",
    focus: "M10 M11 M12 M13",
    completions: "M9 M14",
    explanation:
      "M12の後はM10からM13まで四つ並ぶ。M9とM14はどちらも盤内の空点なので、完成点は二か所。",
  },
  {
    family: "gapped-three",
    group: "practice-gap",
    black: "G8 I8 J8 K12 C3",
    white: "F8 K8 B11 D5 N3",
    move: "H8",
    focus: "G8 H8 I8 J8",
    completions: "",
    blockers: "F8 K8",
    explanation:
      "H8で間を埋めても、F8とK8は両方とも白。四つ並んでも五連にする空点はなく、完成点はゼロ。",
  },
  {
    family: "shared-completion",
    group: "practice-shared",
    black: "D9 E9 H9 F6 F7 F10 L3",
    white: "A4 C12 I2 K11 N6 B8 M14",
    move: "F9",
    focus: "D9 E9 F9 H9 F6 F7 F10",
    completions: "G9 F8",
    explanation:
      "横のD9からH9はG9、縦のF6からF10はF8で五連になる。異なる空点なので完成点は二か所。",
  },
];

export const conditionsAssessments = freeze(
  assessmentSpecs.map((spec, i) => question(spec, i + 1)),
);
export const conditionsPracticeLessons = freeze(
  practiceSpecs.map((spec, i) => question(spec, i + 1, "lesson")),
);
