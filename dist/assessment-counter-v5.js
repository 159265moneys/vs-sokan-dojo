import { parse, coord } from "./game.js";

const points = (text = "") => text.split(/\s+/).filter(Boolean).map(parse);
const makeBoard = (black, white) => {
  const board = Array(225).fill(0);
  for (const [text, side] of [
    [black, 1],
    [white, 2],
  ])
    for (const i of points(text)) {
      if (board[i]) throw Error(`反撃比較盤の重複: ${coord(i)}`);
      board[i] = side;
    }
  return board;
};
const freeze = (value) => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

// Each pair changes one white stone. Neither the prompt, choices, nor the
// continuation objective tells the learner whether the candidate is safe.
const assessmentPairs = [
  {
    family: "straight-reply",
    black: "E8 F8 H8",
    threat: "G5 G6 G7",
    clear: "G5 G6 H7",
    candidate: "D8",
    reply: "G8",
    finishes: "G9 G4",
    threatGuide: "G8",
    clearGuide: "D8 G8 I8",
  },
  {
    family: "inside-gap",
    black: "E8 G8 H8",
    threat: "F7 F9 F10",
    clear: "F7 F9 G10",
    candidate: "I8",
    reply: "F8",
    finishes: "F11 F6",
    threatGuide: "F8",
    clearGuide: "D8 F8 I8",
  },
  {
    family: "closed-end",
    black: "E8 F8 G8 I4",
    threat: "D8 I5 I6 I7",
    clear: "D8 I5 I6 J7",
    blackFocus: "E8 F8 G8",
    threatFocus: "I5 I6 I7",
    clearFocus: "I5 I6 J7",
    candidate: "H8",
    reply: "I8",
    finishes: "I9",
    threatGuide: "I8",
    clearGuide: "H8 I8",
  },
  {
    family: "diagonal-attack",
    black: "F8 G7 I5",
    threat: "F6 G6 I6",
    clear: "F6 G6 I7",
    candidate: "E9",
    reply: "H6",
    finishes: "E6 J6",
    threatGuide: "H6",
    clearGuide: "E9 H6 J4",
  },
  {
    family: "crossed-diagonals",
    black: "C11 D10 F8",
    threat: "B6 C7 D8",
    clear: "B6 C7 E8",
    candidate: "B12",
    reply: "E9",
    finishes: "F10 A5",
    threatGuide: "E9",
    clearGuide: "B12 E9 G7",
  },
  {
    family: "board-edge",
    black: "F1 G1 I1",
    threat: "E4 F3 G2",
    clear: "E4 F3 H2",
    candidate: "E1",
    reply: "H1",
    finishes: "D5",
    threatGuide: "H1",
    clearGuide: "E1 H1 J1",
  },
];

const practicePairs = [
  {
    family: "closed-gap",
    black: "E6 F6 H6 G2",
    threat: "D6 G3 G4 G5",
    clear: "D6 G3 G4 H5",
    blackFocus: "E6 F6 H6",
    threatFocus: "G3 G4 G5",
    clearFocus: "G3 G4 H5",
    candidate: "I6",
    reply: "G6",
    finishes: "G7",
    threatGuide: "G6",
    clearGuide: "G6 I6",
  },
];

const choiceLabels = [
  ["open-four", "2つ以上"],
  ["four", "1つ"],
  ["clear", "なし"],
];

function makeProblem(spec, domain, role) {
  const board = makeBoard(spec.black, spec[domain]),
    candidate = parse(spec.candidate),
    reply = parse(spec.reply),
    blackFocus = points(spec.blackFocus || spec.black),
    whiteFocus = points(spec[`${domain}Focus`] || spec[domain]),
    finishes = domain === "threat" ? points(spec.finishes) : [],
    outcome =
      finishes.length > 1 ? "open-four" : finishes.length ? "four" : "clear",
    candidateBoard = [...board],
    replyBoard = [...board];
  candidateBoard[candidate] = 1;
  replyBoard[candidate] = 1;
  replyBoard[reply] = 2;
  const title =
      outcome === "open-four"
        ? "受けが活四になる"
        : outcome === "four"
          ? "受けが四になる"
          : "受けても四にならない",
    explanation = finishes.length
      ? `白${spec.reply}で受けると、${finishes.map(coord).join("・")}が白の完成点。`
      : `白${spec.reply}で受けた後、白の完成点はない。`,
    frames = [
      {
        board: candidateBoard,
        last: candidate,
        title: `仮想手順：黒${spec.candidate}`,
        text: `黒の完成点は${spec.reply}。白の受けでできる形を読む。`,
        highlights: [
          { cells: [...blackFocus, candidate], points: [reply], tone: "focus" },
        ],
      },
      {
        board: replyBoard,
        last: reply,
        title: `仮想手順：白${spec.reply}`,
        text: explanation,
        highlights: [
          {
            cells: [...whiteFocus, reply],
            points: finishes,
            tone: finishes.length ? "danger" : "focus",
          },
        ],
      },
    ];
  return {
    id: `${role === "assessment" ? "check" : "practice"}-counter-v5-${spec.family}-${domain}`,
    role,
    unitId: "counter",
    skillId: "counter",
    family: `counter/v5-${spec.family}`,
    branchId: `${spec.family}-${domain}`,
    assessmentDomain: `counter-${domain}`,
    ...(role === "lesson"
      ? { teachesAssessmentDomain: `counter-${domain}` }
      : {}),
    requiresBranch: false,
    title: "白の受けを読む",
    goal: "印の黒手に白が受けると、白の完成点は？",
    kind: "compare",
    goalKind: "compare-counter",
    completion: "local-goal",
    board,
    sideToMove: 1,
    rootNodeId: "start",
    questionHighlights: [{ cells: [], points: [candidate], tone: "focus" }],
    hintTexts: [
      "印へ黒を置いた形から、黒の完成点を探す。",
      "その完成点に白が受けたときの、白石のつながりを見る。",
      "受けた後、白が一手で五連にできる空点を数える。",
    ],
    hintStages: [
      [{ cells: blackFocus, points: [candidate], tone: "focus" }],
      [{ cells: whiteFocus, points: [reply], tone: "focus" }],
      [{ cells: whiteFocus, points: [reply, ...finishes], tone: "focus" }],
    ],
    prediction: { candidate, reply, outcome, whiteFinishes: finishes },
    guide: points(spec[`${domain}Guide`]),
    judge: { kind: "compare" },
    nodes: [
      {
        id: "start",
        input: "choice",
        hints: [],
        choices: choiceLabels.map(([id, label]) => ({
          id,
          title: label,
          correct: id === outcome,
          resultTitle: title,
          text: explanation,
          frames,
          ...(id === outcome
            ? {
                continuations: [
                  {
                    moves: [],
                    cells: [],
                    objective: "safe-four",
                    title: "元の盤で、白に受け四を与えない四を作る",
                  },
                ],
              }
            : {}),
        })),
      },
    ],
    evidence: {
      source: "original",
      sourceId: null,
      scope:
        "候補後の全白合法応手と、元盤の全黒合法一手を有限目標で検証。全局最善・全局勝ちは判定しない。",
      verification:
        "tests/assessment-counter-v5.test.mjs; independent five-cell windows; freestyle15, >=5",
    },
  };
}

export const counterAssessmentProblems = freeze(
  assessmentPairs.flatMap((spec) =>
    ["threat", "clear"].map((domain) =>
      makeProblem(spec, domain, "assessment"),
    ),
  ),
);
export const counterPracticeProblems = freeze(
  practicePairs.flatMap((spec) =>
    ["threat", "clear"].map((domain) => makeProblem(spec, domain, "lesson")),
  ),
);
export const counterProblemsV5 = freeze([
  ...counterAssessmentProblems,
  ...counterPracticeProblems,
]);
