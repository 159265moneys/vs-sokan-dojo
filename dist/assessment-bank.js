import { parse, coord } from "./game.js";

const points = (s = "") => s.split(/\s+/).filter(Boolean).map(parse);
const board = (black, white) => {
  const b = Array(225).fill(0);
  for (const [text, side] of [
    [black, 1],
    [white, 2],
  ])
    for (const i of points(text)) {
      if (b[i]) throw Error(`確認盤の重複: ${coord(i)}`);
      b[i] = side;
    }
  return b;
};
const original = {
  source: "original",
  sourceId: null,
  scope:
    "独立した自作確認盤。全合法初手を有限目標・勝ち証明・未判定に分け、準備手は全白応手からの継続を検証。",
  verification:
    "scripts/generate-assessments.mjs / tests/assessment-bank.test.mjs; freestyle15, >=5",
};
const play = (
  id,
  unitId,
  family,
  branchId,
  black,
  white,
  guide,
  extra = {},
) => ({
  id: `check-${id}`,
  role: "assessment",
  unitId,
  skillId: unitId,
  family: `${unitId}/${family}`,
  branchId,
  requiresBranch: true,
  title: "確認盤",
  goal: "白の応手を読み、五連まで続ける",
  kind: "play",
  goalKind: "win",
  completion: "five",
  board: board(black, white),
  sideToMove: 1,
  rootNodeId: "start",
  nodes: [],
  guide: points(guide),
  judge: {
    kind: "win",
    maxPly: 9,
    maxNodes: 1600,
    setups: [],
    observations: [],
  },
  evidence: { ...original },
  ...extra,
});
const prevent = (
  id,
  unitId,
  family,
  branchId,
  black,
  white,
  guide,
  extra = {},
) =>
  play(id, unitId, family, branchId, black, white, guide, {
    requiresBranch: false,
    goal: "白の次の五連・二つの勝ち口を消す。今勝てるなら五連",
    goalKind: "prevent-fork",
    completion: "local-goal",
    judge: { kind: "prevent-fork", maxPly: 7, maxNodes: 1200 },
    ...extra,
  });
const frame = (b, last, title, text, cells = [], targets = []) => ({
  board: [...b],
  last,
  title,
  text,
  highlights: [{ cells: [...cells], points: [...targets], tone: "focus" }],
});
const moveFrame = (b, label, text) => {
  const n = [...b],
    i = parse(label);
  n[i] = 1;
  return frame(n, i, "組み立てを比べる", text, [i]);
};
const continuation = (first, reply, cells) => ({
  moves: [
    { i: parse(first), side: 1 },
    { i: parse(reply), side: 2 },
  ],
  cells: points(cells),
  objective: "open-three",
  title: "残った二石から三を作る",
});
function opening(id, branchId, black, white, options) {
  const b = board(black, white);
  return {
    ...play(id, "opening", "spaced-two-axis", branchId, black, white, ""),
    goal: "二方向の組み立てを選び、白の応手後に三を作る",
    kind: "compare",
    goalKind: "compare-plan",
    completion: "comparison",
    judge: { kind: "compare" },
    nodes: [
      {
        id: "start",
        input: "choice",
        hints: [],
        choices: options.map((o) => ({
          id: o.move.toLowerCase(),
          title: o.move,
          correct: o.correct,
          resultTitle: o.correct ? "残る方向を使う" : "二つの線を確かめる",
          text: o.text,
          frames: [moveFrame(b, o.move, o.text)],
          ...(o.correct
            ? {
                continuations: o.replies.map(([r, c]) =>
                  continuation(o.move, r, c),
                ),
              }
            : {}),
        })),
      },
    ],
  };
}
const bank = [
  play(
    "priority-gap-a",
    "priority",
    "own-win-first",
    "diagonal-versus-open-four",
    "C11 E9 F8 G7",
    "J4 K4 L4 M4",
    "D10",
    {
      requiresBranch: false,
      goal: "黒の一手を選ぶ",
      intentionalImmediate: { black: true, white: true },
    },
  ),
  play(
    "priority-gap-b",
    "priority",
    "own-win-first",
    "two-single-gap-fours",
    "B13 C12 D11 F9",
    "J3 J4 J5 J7",
    "E10",
    {
      requiresBranch: false,
      goal: "黒の一手を選ぶ",
      intentionalImmediate: { black: true, white: true },
    },
  ),
  prevent(
    "priority-defend-a",
    "priority",
    "prevent-immediate-loss",
    "closed-straight-four",
    "D10 F6 H6 J7",
    "E10 F10 G10 H10",
    "I10",
    {
      goal: "黒の一手を選ぶ",
      intentionalImmediate: { black: false, white: true },
      judge: {
        kind: "prevent-fork",
        maxPly: 7,
        maxNodes: 1200,
        successTitle: "白の五連を止めた",
        successText:
          "黒には今すぐ五連にする手がない。白の完成点I10を塞ぎ、即負けを防いだ。勝負は続く。",
      },
    },
  ),
  prevent(
    "priority-defend-b",
    "priority",
    "prevent-immediate-loss",
    "diagonal-four-with-inner-gap",
    "E7 F6 J9 L11",
    "C12 D11 F9 G8",
    "E10",
    {
      goal: "黒の一手を選ぶ",
      intentionalImmediate: { black: false, white: true },
      judge: {
        kind: "prevent-fork",
        maxPly: 7,
        maxNodes: 1200,
        successTitle: "白の五連を止めた",
        successText:
          "黒には今すぐ五連にする手がない。白の完成点E10を塞ぎ、即負けを防いだ。勝負は続く。",
      },
    },
  ),
  play(
    "conditions-gap-a",
    "conditions",
    "broken-three-room",
    "horizontal-inside-gap",
    "D10 F10 G10",
    "B10 K4 M7",
    "E10",
    {
      goal: "一手で勝ち口を二つ作り、五連まで続ける",
      judge: {
        kind: "open-four-first",
        maxPly: 9,
        maxNodes: 1600,
        setups: [],
        observations: [],
      },
    },
  ),
  play(
    "conditions-gap-b",
    "conditions",
    "broken-three-room",
    "diagonal-inside-gap",
    "D11 F9 G8",
    "B13 L4 M12",
    "E10",
    {
      goal: "一手で勝ち口を二つ作り、五連まで続ける",
      judge: {
        kind: "open-four-first",
        maxPly: 9,
        maxNodes: 1600,
        setups: [],
        observations: [],
      },
    },
  ),
  play(
    "conditions-cross-a",
    "conditions",
    "crossed-closed-fours",
    "two-end-extensions",
    "B8 C8 D8 E5 E6 E7",
    "A8 E4 K2 M2 N4 O6",
    "E8",
    {
      goal: "一手で勝ち口を二つ作り、五連まで続ける",
      judge: {
        kind: "open-four-first",
        maxPly: 9,
        maxNodes: 1600,
        setups: [],
        observations: [],
      },
    },
  ),
  play(
    "conditions-cross-b",
    "conditions",
    "crossed-closed-fours",
    "two-inside-gaps",
    "C8 D8 F8 E6 E7 E9",
    "B8 E5 K2 M2 N4 O6",
    "E8",
    {
      goal: "一手で勝ち口を二つ作り、五連まで続ける",
      judge: {
        kind: "open-four-first",
        maxPly: 9,
        maxNodes: 1600,
        setups: [],
        observations: [],
      },
    },
  ),
  opening("opening-space-a", "two-separated-diagonal-axes", "F8 J8", "H8 L9", [
    {
      move: "H6",
      correct: true,
      text: "F8とJ8にそれぞれ斜めの線が通る。白が一方を塞いでも、もう一方の二石を使える。",
      replies: [
        ["G7", "H6 J8"],
        ["I7", "F8 H6"],
      ],
    },
    {
      move: "H10",
      correct: true,
      text: "F8とJ8にそれぞれ斜めの線が通る。白の着点を見て、残った側をつなぐ。",
      replies: [
        ["G9", "H10 J8"],
        ["I9", "F8 H10"],
      ],
    },
    {
      move: "F9",
      correct: false,
      text: "F8とは縦につながるが、J8とは縦・横・斜めの線を共有しない。二方向を残す今回の条件には届かない。",
    },
  ]),
  opening("opening-space-b", "orthogonal-and-diagonal-axes", "F7 J9", "F9 H9", [
    {
      move: "H7",
      correct: true,
      text: "F7へは横、J9へは斜めの線が通る。白が一方を塞いだら、残った二石を使う。",
      replies: [
        ["G7", "H7 J9"],
        ["I8", "F7 H7"],
      ],
    },
    {
      move: "G8",
      correct: false,
      text: "F7との斜めはH9の白で狭く、J9とは同じ直線に乗らない。二つの三を用意する条件を満たさない。",
    },
  ]),
  prevent(
    "opening-reply-a",
    "opening",
    "early-reply-priority",
    "central-broken-three",
    "H8 H10 K9",
    "F6 G6 I6",
    "H6 E6 J6",
  ),
  prevent(
    "opening-reply-b",
    "opening",
    "early-reply-priority",
    "remote-vertical-broken-three",
    "F8 G9 J10",
    "K5 K6 K8",
    "K7 K4 K9",
  ),
  prevent(
    "defense-gap-a",
    "defense",
    "distant-broken-threat",
    "gap-before-four",
    "H8 I7 J9",
    "C10 D10 F10",
    "E10 B10 G10",
  ),
  prevent(
    "defense-cross",
    "defense",
    "two-axis-threat",
    "shared-gap-two-closed-fours",
    "C8 F5 K2 M4 N7 O11",
    "D8 E8 G8 F6 F7 F9",
    "F8 F10 H8",
  ),
  prevent(
    "defense-gap-b",
    "defense",
    "distant-broken-threat",
    "remote-diagonal-with-decoy",
    "F8 G8 H9 B4 J6",
    "K11 L10 N8 C5 D5",
    "M9 J12 O7",
  ),
  prevent(
    "defense-cross-straight",
    "defense",
    "two-axis-threat",
    "shared-extension-two-closed-fours",
    "E7 I3 A1 C2 M11 O14",
    "F7 G7 H7 I4 I5 I6",
    "I7 I8 J7",
  ),
  play(
    "order-gap-a",
    "order",
    "shared-point-before-gap",
    "endpoint-then-inner-gap",
    "D9 E9 F9 G6 G8",
    "C9 L5 A1 C2 M3",
    "G9",
  ),
  play(
    "order-gap-b",
    "order",
    "shared-point-before-gap",
    "inner-gap-then-inner-gap",
    "E10 F10 H10 G7 G9",
    "D10 L5 A1 C2 M3",
    "G10",
  ),
  play(
    "order-chain-a",
    "order",
    "multi-step-forcing-turn",
    "diagonal-chain-against-white-three",
    "J11 K10 F9 H8 K8 H7 J7 J5",
    "E11 F10 F8 I8 K6 F5 G5 H5",
    "I6",
  ),
  play(
    "order-chain-b",
    "order",
    "multi-step-forcing-turn",
    "diagonal-then-vertical",
    "K11 J9 F8 H8 G7 J6 K6 F5",
    "I11 I10 K10 E9 K8 E7 K7 J5",
    "I9",
  ),
  play(
    "counter-finish-a",
    "counter",
    "defend-with-two-finishes",
    "block-at-end-of-own-line",
    "A9 F6 F7 F8",
    "B9 C9 D9 E9",
    "F9",
    { intentionalImmediate: { black: false, white: true } },
  ),
  play(
    "counter-finish-b",
    "counter",
    "defend-with-two-finishes",
    "block-in-own-gap",
    "A9 F7 F8 F10",
    "B9 C9 D9 E9",
    "F9",
    { intentionalImmediate: { black: false, white: true } },
  ),
  play(
    "counter-chain-a",
    "counter",
    "defend-and-continue",
    "counter-to-broken-four",
    "G10 I10 K8 G7 I7 K7 I5 J5 E2 A3 C2",
    "I11 F10 K10 G9 H8 I6 E5 F5 F3 G4 H5",
    "J7",
    { intentionalImmediate: { black: false, white: true } },
  ),
  play(
    "counter-chain-b",
    "counter",
    "defend-and-continue",
    "counter-to-long-vertical-chain",
    "J10 K10 G8 J8 G6 J6 H5 J5 E9 A3 C2 E1",
    "J11 G10 I10 G9 J9 K9 K7 G5 F8 G7 H6 I5",
    "J4",
    { intentionalImmediate: { black: false, white: true } },
  ),
  play(
    "switch-cross-a",
    "branch",
    "centered-open-threes",
    "orthogonal-central-cross",
    "E8 G8 F7 F9",
    "A1 C2 L3 N5",
    "F8",
  ),
  play(
    "switch-cross-b",
    "branch",
    "centered-open-threes",
    "diagonal-central-cross",
    "H10 J8 H8 J10",
    "A1 C3 L4 N6",
    "I9",
  ),
  play(
    "switch-gap-a",
    "branch",
    "two-broken-threes",
    "orthogonal-two-gaps",
    "E6 H6 G3 G5",
    "A1 C2 L3 N5",
    "G6",
  ),
  play(
    "switch-gap-b",
    "branch",
    "two-broken-threes",
    "diagonal-two-gaps",
    "I12 L9 I8 L11",
    "A1 C2 L3 N5",
    "K10",
  ),
];

bank.push(
  play(
    "prepare-1",
    "prepare",
    "mixed-reserve-entries",
    "horizontal-gap-and-diagonal-end",
    "G8 I8 C7 G7 B6 H6 J6 K5",
    "A15 C15 M15 O15 J8 I5 A1 O1",
    "F8",
    { initialFourCount: 0, quietSetupMoves: points("F8") },
  ),
);
bank.push(
  play(
    "prepare-2",
    "prepare",
    "mixed-reserve-entries",
    "horizontal-end-and-diagonal-gap",
    "K14 K12 L12 J10 G9 H9 L7 M6",
    "A15 C15 M15 O15 M13 F9 A1 O1",
    "I9",
    { initialFourCount: 0, quietSetupMoves: points("I9") },
  ),
);
bank.push(
  play(
    "prepare-3",
    "prepare",
    "inside-gap-reserves",
    "two-inner-gaps-mixed-support",
    "K8 J7 E6 E5 F5 I4 D3 J3",
    "A15 C15 M15 O15 C2 K2 A1 O1",
    "G6",
    { initialFourCount: 0, quietSetupMoves: points("G6") },
  ),
);
bank.push(
  play(
    "prepare-4",
    "prepare",
    "inside-gap-reserves",
    "two-inner-gaps-separated-support",
    "G12 H11 J10 J8 K6 K4 M4 J3",
    "A15 C15 M15 O15 J11 N3 A1 O1",
    "J7",
    { initialFourCount: 0, quietSetupMoves: points("J7") },
  ),
);
bank.push(
  play(
    "practical-1",
    "practice",
    "record-forcing-order",
    "assessment-selfplay-f7",
    "H11 F9 G9 H9 E8 H8 E7 G7 L7 C4",
    "G10 I9 G8 F7 H7 I7 J7 K7 E6 D5",
    "H12 H10 D9 E9",
    {
      sourceMoves: [
        { i: 112, side: 1 },
        { i: 125, side: 2 },
        { i: 96, side: 1 },
        { i: 111, side: 2 },
        { i: 97, side: 1 },
        { i: 127, side: 2 },
        { i: 95, side: 1 },
        { i: 98, side: 2 },
        { i: 124, side: 1 },
        { i: 128, side: 2 },
        { i: 109, side: 1 },
        { i: 139, side: 2 },
        { i: 67, side: 1 },
        { i: 129, side: 2 },
        { i: 126, side: 1 },
        { i: 130, side: 2 },
        { i: 131, side: 1 },
        { i: 153, side: 2 },
        { i: 167, side: 1 },
        { i: 81, side: 2 },
      ],
      sourceRecord: [
        { i: 112, side: 1 },
        { i: 125, side: 2 },
        { i: 96, side: 1 },
        { i: 111, side: 2 },
        { i: 97, side: 1 },
        { i: 127, side: 2 },
        { i: 95, side: 1 },
        { i: 98, side: 2 },
        { i: 124, side: 1 },
        { i: 128, side: 2 },
        { i: 109, side: 1 },
        { i: 139, side: 2 },
        { i: 67, side: 1 },
        { i: 129, side: 2 },
        { i: 126, side: 1 },
        { i: 130, side: 2 },
        { i: 131, side: 1 },
        { i: 153, side: 2 },
        { i: 167, side: 1 },
        { i: 81, side: 2 },
        { i: 82, side: 1 },
        { i: 52, side: 2 },
        { i: 110, side: 1 },
        { i: 68, side: 2 },
        { i: 138, side: 1 },
      ],
      evidence: {
        source: "record",
        sourceId: "assessment-selfplay-f7",
        scope:
          "今回生成したRapfi対Rapfiの独立棋譜。初手H8・白の初手のみ指定、以後は両者150ms。学習者の実戦成績・最強CPU成績を意味しない。",
        verification:
          "完全合法手順を空盤から再生。採用局面の勝ちは独立した有限VCF証明。評価点で不正解を決めない。",
        engine: { name: "Rapfi", searchMs: 150, forcedOpening: ["H8", "F7"] },
      },
    },
  ),
);
bank.push(
  play(
    "practical-2",
    "practice",
    "record-two-finishes",
    "assessment-selfplay-f6",
    "A8 F8 H8 E7 H7 H6 I6 K6 J5 I4 I3",
    "B8 C8 D8 E8 G8 F6 G5 H5 I5 H4 H3",
    "H10 H9 M8 L7 G6 J6 L6 K4 L3",
    {
      sourceMoves: [
        { i: 112, side: 1 },
        { i: 140, side: 2 },
        { i: 143, side: 1 },
        { i: 156, side: 2 },
        { i: 127, side: 1 },
        { i: 172, side: 2 },
        { i: 188, side: 1 },
        { i: 109, side: 2 },
        { i: 173, side: 1 },
        { i: 158, side: 2 },
        { i: 159, side: 1 },
        { i: 111, side: 2 },
        { i: 145, side: 1 },
        { i: 187, side: 2 },
        { i: 142, side: 1 },
        { i: 108, side: 2 },
        { i: 124, side: 1 },
        { i: 107, side: 2 },
        { i: 110, side: 1 },
        { i: 106, side: 2 },
        { i: 105, side: 1 },
        { i: 157, side: 2 },
      ],
      sourceRecord: [
        { i: 112, side: 1 },
        { i: 140, side: 2 },
        { i: 143, side: 1 },
        { i: 156, side: 2 },
        { i: 127, side: 1 },
        { i: 172, side: 2 },
        { i: 188, side: 1 },
        { i: 109, side: 2 },
        { i: 173, side: 1 },
        { i: 158, side: 2 },
        { i: 159, side: 1 },
        { i: 111, side: 2 },
        { i: 145, side: 1 },
        { i: 187, side: 2 },
        { i: 142, side: 1 },
        { i: 108, side: 2 },
        { i: 124, side: 1 },
        { i: 107, side: 2 },
        { i: 110, side: 1 },
        { i: 106, side: 2 },
        { i: 105, side: 1 },
        { i: 157, side: 2 },
        { i: 144, side: 1 },
        { i: 146, side: 2 },
        { i: 141, side: 1 },
      ],
      evidence: {
        source: "record",
        sourceId: "assessment-selfplay-f6",
        scope:
          "今回生成したRapfi対Rapfiの独立棋譜。初手H8・白の初手のみ指定、以後は両者150ms。学習者の実戦成績・最強CPU成績を意味しない。",
        verification:
          "完全合法手順を空盤から再生。採用局面の勝ちは独立した有限VCF証明。評価点で不正解を決めない。",
        engine: { name: "Rapfi", searchMs: 150, forcedOpening: ["H8", "F6"] },
      },
    },
  ),
);
bank.push(
  play(
    "practical-3",
    "practice",
    "record-defend-existing-threats",
    "assessment-selfplay-k8",
    "I11 J11 K11 I10 H9 I9 H8 H7 I7 H5",
    "K12 H10 M10 J9 I8 K8 F7 J7 H6 I6",
    "L9",
    {
      intentionalImmediate: { black: false, white: true },
      sourceMoves: [
        { i: 112, side: 1 },
        { i: 115, side: 2 },
        { i: 127, side: 1 },
        { i: 99, side: 2 },
        { i: 97, side: 1 },
        { i: 82, side: 2 },
        { i: 83, side: 1 },
        { i: 125, side: 2 },
        { i: 128, side: 1 },
        { i: 143, side: 2 },
        { i: 98, side: 1 },
        { i: 129, side: 2 },
        { i: 68, side: 1 },
        { i: 113, side: 2 },
        { i: 157, side: 1 },
        { i: 142, side: 2 },
        { i: 69, side: 1 },
        { i: 55, side: 2 },
        { i: 70, side: 1 },
        { i: 87, side: 2 },
      ],
      sourceRecord: [
        { i: 112, side: 1 },
        { i: 115, side: 2 },
        { i: 127, side: 1 },
        { i: 99, side: 2 },
        { i: 97, side: 1 },
        { i: 82, side: 2 },
        { i: 83, side: 1 },
        { i: 125, side: 2 },
        { i: 128, side: 1 },
        { i: 143, side: 2 },
        { i: 98, side: 1 },
        { i: 129, side: 2 },
        { i: 68, side: 1 },
        { i: 113, side: 2 },
        { i: 157, side: 1 },
        { i: 142, side: 2 },
        { i: 69, side: 1 },
        { i: 55, side: 2 },
        { i: 70, side: 1 },
        { i: 87, side: 2 },
        { i: 101, side: 1 },
        { i: 126, side: 2 },
        { i: 67, side: 1 },
        { i: 71, side: 2 },
        { i: 66, side: 1 },
      ],
      evidence: {
        source: "record",
        sourceId: "assessment-selfplay-k8",
        scope:
          "新規Rapfi自己対局。初手H8・白初手K8のみ指定、以後は両者150ms。最強CPUへの成績ではない。",
        verification:
          "空盤からの全手順合法性と全合法白応手のVCF継続を独立検証。",
        engine: { name: "Rapfi", searchMs: 150, forcedOpening: ["H8", "K8"] },
      },
    },
  ),
);
bank.push(
  play(
    "practical-4",
    "practice",
    "record-forcing-order",
    "assessment-selfplay-j5",
    "H10 G9 L9 H8 I8 H7 I7 J7 G6 M5",
    "H9 I9 J9 K9 J8 K7 H6 J6 L6 J5",
    "E11 F10 G7 F5 E4",
    {
      sourceMoves: [
        { i: 112, side: 1 },
        { i: 159, side: 2 },
        { i: 113, side: 1 },
        { i: 114, side: 2 },
        { i: 127, side: 1 },
        { i: 142, side: 2 },
        { i: 128, side: 1 },
        { i: 98, side: 2 },
        { i: 129, side: 1 },
        { i: 130, side: 2 },
        { i: 82, side: 1 },
        { i: 97, side: 2 },
        { i: 141, side: 1 },
        { i: 99, side: 2 },
        { i: 96, side: 1 },
        { i: 146, side: 2 },
        { i: 162, side: 1 },
        { i: 100, side: 2 },
        { i: 101, side: 1 },
        { i: 144, side: 2 },
      ],
      sourceRecord: [
        { i: 112, side: 1 },
        { i: 159, side: 2 },
        { i: 113, side: 1 },
        { i: 114, side: 2 },
        { i: 127, side: 1 },
        { i: 142, side: 2 },
        { i: 128, side: 1 },
        { i: 98, side: 2 },
        { i: 129, side: 1 },
        { i: 130, side: 2 },
        { i: 82, side: 1 },
        { i: 97, side: 2 },
        { i: 141, side: 1 },
        { i: 99, side: 2 },
        { i: 96, side: 1 },
        { i: 146, side: 2 },
        { i: 162, side: 1 },
        { i: 100, side: 2 },
        { i: 101, side: 1 },
        { i: 144, side: 2 },
        { i: 126, side: 1 },
        { i: 125, side: 2 },
        { i: 111, side: 1 },
        { i: 81, side: 2 },
        { i: 156, side: 1 },
      ],
      evidence: {
        source: "record",
        sourceId: "assessment-selfplay-j5",
        scope:
          "今回生成したRapfi対Rapfiの独立棋譜。初手H8・白の初手のみ指定、以後は両者150ms。学習者の実戦成績・最強CPU成績を意味しない。",
        verification:
          "完全合法手順を空盤から再生。採用局面の勝ちは独立した有限VCF証明。評価点で不正解を決めない。",
        engine: { name: "Rapfi", searchMs: 150, forcedOpening: ["H8", "J5"] },
      },
    },
  ),
);

const verifiedJudgments = {
  "check-priority-gap-a": { guide: [78], setups: [] },
  "check-priority-gap-b": { guide: [79], setups: [] },
  "check-priority-defend-a": { guide: [83], setups: [] },
  "check-priority-defend-b": { guide: [79], setups: [] },
  "check-conditions-gap-a": { guide: [79], setups: [] },
  "check-conditions-gap-b": { guide: [79], setups: [] },
  "check-conditions-cross-a": { guide: [109], setups: [] },
  "check-conditions-cross-b": { guide: [109], setups: [] },
  "check-opening-reply-a": { guide: [139, 142, 144], setups: [] },
  "check-opening-reply-b": { guide: [100, 130, 175], setups: [] },
  "check-defense-gap-a": { guide: [76, 79, 81], setups: [] },
  "check-defense-cross": { guide: [80, 110, 112], setups: [] },
  "check-defense-gap-b": { guide: [54, 102, 134], setups: [] },
  "check-defense-cross-straight": { guide: [113, 128, 129], setups: [] },
  "check-order-gap-a": { guide: [96], setups: [] },
  "check-order-gap-b": { guide: [81], setups: [] },
  "check-order-chain-a": { guide: [143], setups: [] },
  "check-order-chain-b": { guide: [98], setups: [] },
  "check-counter-finish-a": { guide: [95], setups: [] },
  "check-counter-finish-b": { guide: [95], setups: [] },
  "check-counter-chain-a": { guide: [129], setups: [] },
  "check-counter-chain-b": { guide: [174], setups: [] },
  "check-switch-cross-a": {
    guide: [110],
    setups: [
      {
        move: 110,
        replies: [65, 80, 107, 108, 112, 113, 140, 155],
        proof: {
          scope: "all-legal-white-replies",
          replyCount: 216,
          maxContinuationPly: 3,
        },
      },
    ],
  },
  "check-switch-cross-b": {
    guide: [98],
    setups: [
      {
        move: 98,
        replies: [50, 56, 66, 70, 126, 130, 140, 146],
        proof: {
          scope: "all-legal-white-replies",
          replyCount: 216,
          maxContinuationPly: 3,
        },
      },
    ],
  },
  "check-switch-gap-a": {
    guide: [141],
    setups: [
      {
        move: 141,
        replies: [126, 138, 140, 143, 171, 201],
        proof: {
          scope: "all-legal-white-replies",
          replyCount: 216,
          maxContinuationPly: 3,
        },
      },
    ],
  },
  "check-switch-gap-b": {
    guide: [85],
    setups: [
      {
        move: 85,
        replies: [37, 57, 69, 99, 117, 127],
        proof: {
          scope: "all-legal-white-replies",
          replyCount: 216,
          maxContinuationPly: 3,
        },
      },
    ],
  },
  "check-prepare-1": {
    guide: [94, 96, 110, 112, 141],
    setups: [
      {
        move: 94,
        replies: [78, 80, 108, 110, 150],
        proof: {
          scope: "all-legal-white-replies",
          replyCount: 208,
          maxContinuationPly: 7,
        },
      },
      {
        move: 96,
        replies: [66, 81, 112, 128, 141, 156],
        proof: {
          scope: "all-legal-white-replies",
          replyCount: 208,
          maxContinuationPly: 9,
        },
      },
      {
        move: 110,
        replies: [78, 94, 109, 112],
        proof: {
          scope: "all-legal-white-replies",
          replyCount: 208,
          maxContinuationPly: 5,
        },
      },
      {
        move: 112,
        replies: [96, 109, 110, 128, 176],
        proof: {
          scope: "all-legal-white-replies",
          replyCount: 208,
          maxContinuationPly: 7,
        },
      },
      {
        move: 141,
        replies: [81, 96, 140, 143, 145, 156, 171],
        proof: {
          scope: "all-legal-white-replies",
          replyCount: 208,
          maxContinuationPly: 3,
        },
      },
    ],
  },
  "check-prepare-2": {
    guide: [70, 83, 98, 99],
    setups: [
      {
        move: 70,
        replies: [10, 40, 85, 98, 112],
        proof: {
          scope: "all-legal-white-replies",
          replyCount: 208,
          maxContinuationPly: 7,
        },
      },
      {
        move: 83,
        replies: [41, 69, 99, 111, 115],
        proof: {
          scope: "all-legal-white-replies",
          replyCount: 208,
          maxContinuationPly: 9,
        },
      },
      {
        move: 98,
        replies: [70, 99, 100, 112],
        proof: {
          scope: "all-legal-white-replies",
          replyCount: 208,
          maxContinuationPly: 5,
        },
      },
      {
        move: 99,
        replies: [83, 98, 100, 115, 163],
        proof: {
          scope: "all-legal-white-replies",
          replyCount: 208,
          maxContinuationPly: 7,
        },
      },
    ],
  },
  "check-prepare-3": {
    guide: [141, 157, 169, 171],
    setups: [
      {
        move: 141,
        replies: [125, 127, 157, 169],
        proof: {
          scope: "all-legal-white-replies",
          replyCount: 208,
          maxContinuationPly: 5,
        },
      },
      {
        move: 157,
        replies: [101, 125, 141, 143, 153, 156, 158, 171],
        proof: {
          scope: "all-legal-white-replies",
          replyCount: 208,
          maxContinuationPly: 3,
        },
      },
      {
        move: 169,
        replies: [109, 124, 127, 141, 184, 199],
        proof: {
          scope: "all-legal-white-replies",
          replyCount: 208,
          maxContinuationPly: 7,
        },
      },
      {
        move: 171,
        replies: [107, 123, 143, 157, 187, 203],
        proof: {
          scope: "all-legal-white-replies",
          replyCount: 208,
          maxContinuationPly: 5,
        },
      },
    ],
  },
  "check-prepare-4": {
    guide: [99, 129, 161],
    setups: [
      {
        move: 99,
        replies: [35, 83, 115, 129, 144],
        proof: {
          scope: "all-legal-white-replies",
          replyCount: 208,
          maxContinuationPly: 7,
        },
      },
      {
        move: 129,
        replies: [99, 113, 144, 161],
        proof: {
          scope: "all-legal-white-replies",
          replyCount: 208,
          maxContinuationPly: 5,
        },
      },
      {
        move: 161,
        replies: [113, 129, 133, 147, 203, 217],
        proof: {
          scope: "all-legal-white-replies",
          replyCount: 208,
          maxContinuationPly: 7,
        },
      },
    ],
  },
  "check-practical-1": {
    guide: [48, 52, 64, 65, 66, 79, 80, 82, 93, 94, 108, 110, 122],
    setups: [
      {
        move: 48,
        replies: [52, 64, 80, 82, 93, 94],
        proof: {
          scope: "all-legal-white-replies",
          replyCount: 204,
          maxContinuationPly: 5,
        },
      },
      {
        move: 64,
        replies: [48, 52, 79, 80, 82, 93, 94],
        proof: {
          scope: "all-legal-white-replies",
          replyCount: 204,
          maxContinuationPly: 5,
        },
      },
      {
        move: 65,
        replies: [52, 82, 93, 94],
        proof: {
          scope: "all-legal-white-replies",
          replyCount: 204,
          maxContinuationPly: 9,
        },
      },
      {
        move: 66,
        replies: [52, 82, 93, 94, 68],
        proof: {
          scope: "all-legal-white-replies",
          replyCount: 204,
          maxContinuationPly: 7,
        },
      },
      {
        move: 79,
        replies: [52, 64, 82, 93, 94],
        proof: {
          scope: "all-legal-white-replies",
          replyCount: 204,
          maxContinuationPly: 5,
        },
      },
      {
        move: 80,
        replies: [48, 52, 64, 82, 93, 94],
        proof: {
          scope: "all-legal-white-replies",
          replyCount: 204,
          maxContinuationPly: 5,
        },
      },
      {
        move: 108,
        replies: [52, 82, 93, 94, 68],
        proof: {
          scope: "all-legal-white-replies",
          replyCount: 204,
          maxContinuationPly: 9,
        },
      },
      {
        move: 110,
        replies: [52, 68, 82, 93, 94, 138, 152],
        proof: {
          scope: "all-legal-white-replies",
          replyCount: 204,
          maxContinuationPly: 5,
        },
      },
      {
        move: 122,
        replies: [52, 82, 93, 94],
        proof: {
          scope: "all-legal-white-replies",
          replyCount: 204,
          maxContinuationPly: 9,
        },
      },
    ],
  },
  "check-practical-2": {
    guide: [82, 97, 117, 131, 141, 144, 146, 175, 191],
    setups: [],
  },
  "check-practical-3": {
    guide: [101],
    setups: [
      {
        move: 101,
        replies: [38, 53, 56, 66, 67, 71, 72, 84, 126, 0],
        proof: {
          scope: "all-legal-white-replies",
          replyCount: 204,
          maxContinuationPly: 3,
        },
      },
    ],
  },
  "check-practical-4": {
    guide: [64, 80, 126, 143, 155, 169],
    setups: [
      {
        move: 143,
        replies: [64, 80, 87, 115, 125, 126, 155, 157, 158, 169, 173],
        proof: {
          scope: "all-legal-white-replies",
          replyCount: 204,
          maxContinuationPly: 5,
        },
      },
    ],
  },
};
for (const p of bank) {
  const verified = verifiedJudgments[p.id];
  if (verified) {
    p.guide = [
      ...p.guide.filter((i) => verified.guide.includes(i)),
      ...verified.guide.filter((i) => !p.guide.includes(i)),
    ];
    if (p.judge.kind === "win") p.judge.setups = verified.setups;
  }
}
const hintTextsByUnit = {
  priority: [
    "まず黒が今すぐ五連にできるか確かめる。",
    "黒の即勝ちがなければ、白が次に五連にする完成点を探す。",
    "今勝てるなら五連を作り、勝てなければ白の完成点を塞ぐ。",
  ],
  conditions: [
    "黒の三と、その外側の空き方を確かめる。",
    "一列の両端だけでなく、交差する別の線の勝ち口も数える。",
    "置いた後に五連を作れる点が二つ残る候補を比べる。",
  ],
  opening: [
    "黒の二石の間と、白が塞いだ線を見る。",
    "相手が先に四を作るならその地点を優先し、そうでなければ別の二方向を残す。",
    "白の応手で消えなかった線を使う。",
  ],
  defense: [
    "白が次の一手で五連や二つの勝ち口を作る場所を探す。",
    "離れた方向も含めて白の三を確認し、自分の即勝ちと順番を比べる。",
    "白の次の強制勝ちが残らない点を比べる。",
  ],
  order: [
    "黒の四を作れる線と、その続きを探す。",
    "白が受けた石は盤に残る。次に使うつなぎ目を塞がせない順序を読む。",
    "印の候補から、白の応手を一手ずつ追う。",
  ],
  counter: [
    "先に白の五連になる点を確認する。",
    "その点を塞ぐ一石を、黒の四にも使えるか調べる。",
    "受けた後も、白の応手を見て次の四を選ぶ。",
  ],
  branch: [
    "一つの着点が、どの二本の線をつなぐか見る。",
    "連続三なら端、飛び三なら中の空点を確認する。",
    "白が一方を塞いだ後、残った方向で勝ち口を二つ作る。",
  ],
  prepare: [
    "今の盤から四を作る手はない。離れた二石ずつを探す。",
    "白に片側を閉じられた線でも、次の四から別方向へ続けられるか読む。",
    "二本の続きが同時に残る候補を比べ、白の受けた側を見直す。",
  ],
  practice: [
    "盤全体から四・飛び三・共有する空点を拾う。",
    "今ある線だけでなく、白の受け石が残る場所と別方向の続きを読む。",
    "候補を選んだら、白の応手後の五連まで確かめる。",
  ],
};
for (const p of bank) {
  p.hintTexts = hintTextsByUnit[p.unitId];
  if (p.unitId === "order") {
    p.goal = "四を続けて、五連まで打つ";
    p.judge.firstObjective = "forcing-four";
  }
  if (p.judge.kind === "open-four-first") {
    p.judge.failureTitle = "二つの勝ち口を残す";
    p.judge.failureText =
      "一列の両端や交差する別の線を見て、次に五連を作れる空点を二つ数える。";
  }
  if (p.kind === "compare") {
    const own = p.board.flatMap((side, i) => (side === 1 ? [i] : []));
    p.hintStages = [
      [{ cells: own, points: [], tone: "focus" }],
      [
        {
          cells: p.board.flatMap((side, i) => (side ? [i] : [])),
          points: [],
          tone: "focus",
        },
      ],
      [
        {
          cells: own,
          points: p.nodes[0].choices
            .filter((c) => c.correct)
            .map((c) => parse(c.title)),
          tone: "good",
        },
      ],
    ];
  }
}
const unitCounts = {};
for (const p of bank)
  p.title = "確認 " + (unitCounts[p.unitId] = (unitCounts[p.unitId] || 0) + 1);

function freeze(x) {
  if (x && typeof x === "object" && !Object.isFrozen(x)) {
    Object.values(x).forEach(freeze);
    Object.freeze(x);
  }
  return x;
}
export const assessmentProblems = freeze(bank);
