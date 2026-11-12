import {
  priorityDefenseLesson,
  priorityDefenseFrames,
} from "./priority-defense-lesson.js";
import { assessmentProblems } from "./assessment-bank.js";
import { parse, coord, winningMoves, winningLine } from "./game.js";

export const curriculumVersion = "2026-11-11.2";
const points = (s = "") => s.split(/\s+/).filter(Boolean).map(parse);
const makeBoard = (black, white) => {
  const b = Array(225).fill(0);
  for (const [s, side] of [
    [black, 1],
    [white, 2],
  ])
    for (const i of points(s)) {
      if (b[i]) throw Error(`教材の重複: ${coord(i)}`);
      b[i] = side;
    }
  return b;
};
const fromRecord = (s) => {
  const b = Array(225).fill(0);
  points(s).forEach((i, n) => {
    if (b[i]) throw Error("棋譜の重複");
    b[i] = (n % 2) + 1;
  });
  return b;
};
const mark = (cells = "", target = "", tone = "focus") => ({
  cells: points(cells),
  points: points(target),
  tone,
});
const frame = (board, title, text = "", highlights = [], last = null) => ({
  board: [...board],
  last,
  title,
  text,
  highlights,
});
function transitionText(before, after, i, side) {
  const who = side === 1 ? "黒" : "白",
    other = side === 1 ? "白" : "黒";
  const own = winningMoves(after, side),
    enemy = winningMoves(after, 3 - side);
  if (winningLine(after, i).length)
    return `${coord(i)}で五個以上がつながる。${other}が次に打つ前に、この一手で終わる。`;
  if (enemy.length)
    return `${other}には${enemy.map(coord).join("・")}で五連にする手がある。次の${other}の手番で、先に五連を完成できる。`;
  if (own.length >= 2)
    return `${own.map(coord).join("・")}が勝ち口になる。${other}は一手で全部を塞げず、残った点で${who}が五連を作れる。`;
  if (own.length === 1)
    return `${who}は次に${coord(own[0])}で五連を作れる。${other}が他へ打てば、その点で終わる。`;
  if (winningMoves(before, 3 - side).includes(i))
    return `${coord(i)}の五連を防いだ。受けた石も残るので、相手の別方向の攻めを確かめ直す。`;
  return `${coord(i)}の後も、今すぐ五連にする点はない。つながった石から次に作れる形を比べる。`;
}
const lineFrames = (board, line, titles = [], highlights = []) => {
  const b = [...board];
  return points(line).map((i, n) => {
    if (b[i]) throw Error(`教材手順の重複: ${coord(i)}`);
    const before = [...b];
    b[i] = (n % 2) + 1;
    return frame(
      b,
      titles[n] || (n % 2 ? "白の応手" : "黒の一手"),
      transitionText(before, b, i, (n % 2) + 1),
      highlights[n] || [],
      i,
    );
  });
};
const original = (scope) => ({
  source: "original",
  sourceId: null,
  scope,
  verification: "freestyle15 / >=5 / independent exhaustive checks",
});
const setup = (move, replies) => ({
  move: parse(move),
  replies: points(replies),
});
const node = (choices, hints = []) => ({
  id: "start",
  input: "choice",
  choices,
  hints,
});
const choice = (id, title, correct, resultTitle, text, frames, extra = {}) => ({
  id,
  title,
  correct,
  resultTitle,
  text,
  frames,
  ...extra,
});
const play = (id, unitId, family, title, goal, board, guide, extra = {}) => ({
  id,
  unitId,
  family,
  title,
  goal,
  kind: "play",
  goalKind: "win",
  completion: "five",
  board,
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
  evidence: original("証明できる勝ちを受理。未証明の候補は負けと認定しない。"),
  ...extra,
});
const quiz = (id, unitId, family, title, goal, board, choices, extra = {}) => ({
  id,
  unitId,
  family,
  title,
  goal,
  kind: "choice",
  goalKind: "compare-plan",
  completion: "comparison",
  board,
  sideToMove: 1,
  rootNodeId: "start",
  nodes: [node(choices)],
  guide: [],
  judge: { kind: "choice" },
  evidence: original("盤上の限定された事実の比較。唯一最善手の認定ではない。"),
  ...extra,
});

const A = makeBoard("F8 G8 I8 H7 H9 J4", "E8 J5 J6 K2 A1 C1");
const B = makeBoard("F8 G8 I8 H7 H9 J4 B12 D12", "E8 J5 J6 J7 E3 F4 G5 A1");
const C = makeBoard("E5 G7 D11 K12 B3 L6", "H5 H6 H7 F8 G8 I8");
const C2 = makeBoard("E5 G7 D11 K12 B3 L6", "K9 H6 H7 F8 G8 I8");
const D = makeBoard("F8 G8 H6 H7", "B3 D4 K12 M13");
const turning = makeBoard("C8 D8 E8 F5 F6 G7 H7", "B8 F4 I8 J10 H10 L12 K13");
const quiet = makeBoard(
  "D8 E8 F6 F7 H11 H12 I11 J12",
  "C8 D5 J8 L11 H13 L10 M13 B4",
);
const dual = makeBoard(
  "C8 D8 E8 F5 F6 G7 H7 A13 J4 L5 M8",
  "B8 F4 I8 J10 H10 L12 K13 E9 D10 C11 B12",
);
const race = makeBoard("F8 G8 H8 I8", "F5 G5 H5 I5");
const six = makeBoard("E8 F8 G8 I8 J8", "A1 C2 E3 K12 M14");
const room = makeBoard("G8 H8 I8", "E8 A2 D3");
const closed = makeBoard("G8 H8 I8", "E8 K8 A2");
const edge = makeBoard("A8 B8 D8", "K3 M4 K12");
const opening = makeBoard("H8 G8", "H7 I9");
const space = makeBoard("B8 C8", "D8 C9");
const bridge = makeBoard("H8 J8", "I8 K10");
const counterThree = makeBoard("F8 G8 H6 H7 I4", "I5 I6 I7 A1 C1");

const aGood = lineFrames(
  A,
  "H8 J8 H6 H5 H10",
  [
    "横をつなぐ",
    "白はJ8",
    "縦の両端が残る",
    "片側を止めても",
    "もう一方で五連",
  ],
  [
    [mark("F8 G8 H8 I8", "J8", "good")],
    [mark("H7 H8 H9", "H6 H10")],
    [mark("H6 H7 H8 H9", "H5 H10", "good")],
    [],
    [mark("H6 H7 H8 H9 H10", "", "good")],
  ],
);
const aWrong = lineFrames(
  A,
  "J8 H8",
  ["先に外へ延ばすと", "つなぎ目を取られる"],
  [[], [mark("H8", "", "danger"), mark("H7 H9")]],
);
const bLine = lineFrames(
  B,
  "H8 J8 J9 H6 I7 D2",
  [
    "四三に見える",
    "白も四になる",
    "J9を受ける",
    "白の両端四",
    "片側を止めても",
    "白の五連",
  ],
  [
    [mark("F8 G8 H8 I8", "J8"), mark("H7 H8 H9", "H6 H10")],
    [mark("J5 J6 J7 J8", "J9", "danger")],
    [mark("J9"), mark("E3 F4 G5", "H6", "danger")],
    [mark("E3 F4 G5 H6", "D2 I7", "danger")],
    [],
    [mark("D2 E3 F4 G5 H6", "", "danger")],
  ],
);
const cWrong = lineFrames(
  C,
  "F6 H8 E8 J8",
  ["黒の三を作ると", "白に四つの勝ち口", "一つを止めても", "白が五連"],
  [
    [mark("E5 F6 G7")],
    [mark("H5 H6 H7 H8 F8 G8 I8", "H4 H9 E8 J8", "danger")],
    [],
    [mark("F8 G8 H8 I8 J8", "", "danger")],
  ],
);
const cRight = lineFrames(
  C,
  "H8",
  ["二方向の交点を取る"],
  [[mark("H8", "", "good"), mark("H5 H6 H7 F8 G8 I8", "", "danger")]],
);
const dLine = lineFrames(
  D,
  "H8 E8 H5 H4 H9",
  [
    "二方向をつなぐ",
    "横を止められたら",
    "縦へ切り替える",
    "片側を止めても",
    "縦で五連",
  ],
  [
    [mark("F8 G8 H8 H6 H7", "E8 I8 H5 H9")],
    [mark("E8", "", "danger")],
    [mark("H5 H6 H7 H8", "H4 H9", "good")],
    [],
    [mark("H5 H6 H7 H8 H9", "", "good")],
  ],
);
const turnLine = lineFrames(
  turning,
  "F8 G8 F7 F9 E7 D7 I7",
  [
    "横の四",
    "白はG8",
    "縦につなぐ",
    "白はF9",
    "もう一度横へ",
    "片側を止めても",
    "五連",
  ],
  [
    [mark("C8 D8 E8 F8", "G8")],
    [],
    [mark("F5 F6 F7 F8", "F9")],
    [],
    [mark("E7 F7 G7 H7", "D7 I7", "good")],
    [],
    [],
  ],
);
const quietLine = lineFrames(
  quiet,
  "H8 H10 F8 G8 F9 F10 F5",
  [
    "まず準備する",
    "上を止められたら",
    "横から四",
    "白はG8",
    "縦の両端が残る",
    "片側を止めても",
    "五連",
  ],
  [
    [mark("D8 E8 F6 F7 H8 H11 H12 I11 J12")],
    [mark("H10", "", "danger")],
    [mark("D8 E8 F8 H8", "G8")],
    [],
    [mark("F6 F7 F8 F9", "F5 F10", "good")],
    [],
    [],
  ],
);

const openingG9 = lineFrames(
  opening,
  "G9 G10 I7",
  ["二方向を残す", "縦を止められたら", "斜めが残る"],
  [
    [mark("G8 G9 H8", "G10 I7")],
    [mark("G10", "", "danger")],
    [mark("G9 H8 I7", "F10 J6", "good")],
  ],
);
const openingF8 = lineFrames(
  opening,
  "F8 I8 E8 D8",
  ["横の三", "白が片側を止める", "四へ延ばす", "端を止められる"],
  [
    [mark("F8 G8 H8", "E8 I8")],
    [],
    [mark("E8 F8 G8 H8", "D8")],
    [mark("D8 I8", "", "danger")],
  ],
);
const explain = (frames, texts) =>
  frames.forEach((f, n) => {
    if (texts[n]) f.text = texts[n];
  });
explain(aGood, [
  "H8は横を四にし、縦のH7・H9もつなぐ。次に縦へ攻める形を残している。",
  "J8を放置すると黒が五連になるため、白はここを守る。白石がH8を塞がないので縦の攻めが残る。",
  "H6で縦の四ができ、H5とH10が勝ち口になる。横で白を受けさせた一手が、縦の攻めにつながった。",
  "白がH5を塞いでもH10が残る。一手で二つの勝ち口は消せない。",
  "残ったH10に置いて五連。初手だけでなく、受けられた後も最後までつなぐ。",
]);
explain(aWrong, [
  "J8でも横の四にはなるが、勝ち口はH8になる。相手がどこに置くかまで先に読む。",
  "白H8が四を止め、同時にH7とH9の間を分断する。先にH8へ置いた時の縦の攻めは残らない。",
]);
explain(bLine, [
  "H8は横の四と縦の三を同時に作る。しかし、白が受けるJ8にも白石が集まっている。",
  "白J8は黒の四を止めると同時に、J5からJ8までの四になる。今度は黒がJ9を受けないと負ける。",
  "黒は予定していた縦の攻めを続けられず、J9を受ける。白にもう一度手番が渡る。",
  "白H6がE3・F4・G5とつながり、D2とI7の二つの勝ち口を作る。黒の四三より白の攻めが先になった。",
  "黒がI7を止めても、反対側のD2が残る。この段階では一石で受け切れない。",
  "白D2で五連。四三という形の名前だけでは、相手の受け四を除外できない。",
]);
explain(cWrong, [
  "F6で自分の三はできる。しかし白は、H8から縦横の四を同時に作れる。",
  "白H8の後はH4・H9・E8・J8が勝ち口になる。黒の三を伸ばす前に白が勝てるため、先回りが必要だった。",
]);
explain(cRight, [
  "H8は白の縦横の交点。四ができる前にここへ置くと、二方向の攻めを一度に消し、自分のG7ともつながる。",
]);
explain(dLine, [
  "H8が横のF8・G8と縦のH6・H7をつなぐ。白が一方向を塞いでも、もう一方向を使う。",
  "白E8は横の端を止めた。横だけにこだわらず、まだ開いている縦の両端を見る。",
  "H5で縦の四を作る。H4とH9は両方空いていて、白は一手で塞げない。",
  "白がH4を受けたので、反対のH9を使える。白がH9ならH4が残る。",
  "H9で五連。最初に選んだ方向を固定せず、白の応手で切り替えた。",
]);
explain(turnLine, [
  "F8で横の四を作り、白をG8に置かせる。F8自身は次の縦の攻めにも使える。",
  "白はG8を受ける。F5・F6とF8の間にF7が残っている。",
  "F7で縦の四になる。F4は白なので、白が次に受ける点はF9に決まる。",
  "白F9が縦を止めた。その間に置いたF7が、G7・H7と横につながっている。",
  "E7で横の四を作るとD7とI7が残る。横→縦→横と、同じ石の働きを重ねた。",
  "白がD7を塞いでもI7が空いている。白がI7ならD7で終わる。",
  "I7で五連。最初の四で置かせた白石が、次の攻めを妨げない順序だった。",
]);
explain(quietLine, [
  "H8ではまだ三も四もできない。横のD8・E8側と、上のH11・H12側に、次の攻めを用意している。",
  "白H10は上側を止めた。横のD8・E8・H8と、縦のF6・F7はまだ使える。",
  "F8を置くとG8が五連の点になり、白はG8を受ける必要がある。準備したH8が横の四に加わった。",
  "白G8で横が止まる。黒F8はF6・F7と同じ列なので、縦へ攻めを続けられる。",
  "F9で縦の四を作り、F5とF10を残す。横で相手を受けさせた間に、縦の形が整った。",
  "白F10の反対側、F5が残る。次の一手で黒の五連になる。",
  "F5で五連。最初の静かな一手を、白の応手に合わせた四追いにつなげた。",
]);
explain(openingG9, [
  "G9はG8と縦、H8と斜めにつながる。まだ相手を受けさせる手ではないが、次に使える方向が二つある。",
  "白G10が縦を止めた。G9からH8を通る斜めには、まだ白石がない。",
  "I7で斜めの三を作れる。白I7を先に置かれた場合は、G10で縦の三を選ぶ。",
]);
explain(openingF8, [
  "F8で横の三ができる。白はE8かI8を受けて、両端の四を防ぐ。",
  "白I8が片側を塞いだ。反対側は残るが、両端が開いた四にはならない。",
  "E8で四にできるものの、勝ち口はD8の一か所。相手の受けた石を含めて次の形を比べる。",
  "白D8で横は両側から止まる。三を早く作る手と、二方向を残す手では、その後の配置が違う。",
]);
const closedFrames = [
  ...lineFrames(
    closed,
    "F8 J8",
    ["左へ延ばしても", "一か所で止まる"],
    [[mark("F8 G8 H8 I8", "J8")], [mark("E8 J8", "", "danger")]],
  ),
  ...lineFrames(
    closed,
    "J8 F8",
    ["右へ延ばしても", "一か所で止まる"],
    [[mark("G8 H8 I8 J8", "F8")], [mark("F8 K8", "", "danger")]],
  ),
];
const edgeFrames = lineFrames(
  edge,
  "C8 E8",
  ["四が並ぶ", "勝ち口は一つ"],
  [[mark("A8 B8 C8 D8", "E8")], [mark("E8", "", "danger")]],
);

const openingChoices = [
  choice("connect", "G9", true, "応手を見て続ける", "", openingG9.slice(0, 1), {
    continuations: [
      {
        moves: [
          { i: parse("G9"), side: 1 },
          { i: parse("G10"), side: 2 },
        ],
        objective: "open-three",
        title: "残る斜めに三を作る",
        cells: points("G9 H8"),
      },
      {
        moves: [
          { i: parse("G9"), side: 1 },
          { i: parse("I7"), side: 2 },
        ],
        objective: "open-three",
        title: "残る縦に三を作る",
        cells: points("G8 G9"),
      },
    ],
  }),
  choice(
    "three",
    "F8",
    true,
    "応手を見て続ける",
    "この攻め方も試せる。",
    openingF8.slice(0, 1),
    {
      continuations: [
        {
          moves: [
            { i: parse("F8"), side: 1 },
            { i: parse("I8"), side: 2 },
          ],
          objective: "four",
          title: "残った側を四にする",
          cells: points("F8 G8 H8"),
        },
        {
          moves: [
            { i: parse("F8"), side: 1 },
            { i: parse("E8"), side: 2 },
          ],
          objective: "four",
          title: "残った側を四にする",
          cells: points("F8 G8 H8"),
        },
      ],
    },
  ),
  choice(
    "far",
    "E5",
    false,
    "連携を比べる",
    "今ある二石と同じ線につながらない。",
    lineFrames(
      opening,
      "E5",
      ["線を共有しない"],
      [[mark("E5"), mark("G8 H8")]],
    ),
  ),
];

const bank = [
  play(
    "win-before-block",
    "priority",
    "priority/race",
    "先に終わるのは",
    "自分の五連を作る",
    race,
    "E8 J8",
  ),
  priorityDefenseLesson,
  play(
    "long-gap",
    "priority",
    "priority/overline",
    "間をつなぐ",
    "五連以上を完成させる",
    six,
    "H8",
  ),
  play(
    "three-room",
    "conditions",
    "conditions/extension-space",
    "空きは足りるか",
    "両端の空いた四を作り、勝ち切る",
    room,
    "J8",
    {
      judge: {
        kind: "open-four-first",
        maxPly: 5,
        maxNodes: 400,
        setups: [],
        observations: [],
      },
    },
  ),
  quiz(
    "closed-three",
    "conditions",
    "conditions/outer-blockers",
    "三つ並んでいるけれど",
    "次の一手で両端四になるか",
    closed,
    [
      choice(
        "yes",
        "両端四になる",
        false,
        "外側の白を見る",
        "どちらへ延ばしても勝ち口は一つ。",
        closedFrames,
      ),
      choice(
        "no",
        "両端四にはならない",
        true,
        "外側で止まる",
        "両隣だけでなく、その外側も見る。",
        closedFrames,
      ),
    ],
  ),
  quiz(
    "edge-space",
    "conditions",
    "conditions/board-edge",
    "盤の端では",
    "C8の後、勝ち口は何か所か",
    edge,
    [
      choice(
        "two",
        "二か所",
        false,
        "端の先には置けない",
        "E8の一か所。",
        edgeFrames,
      ),
      choice("one", "一か所", true, "E8だけが残る", "", edgeFrames),
    ],
  ),
  quiz(
    "opening-two-plans",
    "opening",
    "opening/two-directions",
    "二つの組み立て",
    "候補を選び、白の応手から続きを考える",
    opening,
    openingChoices,
    { kind: "compare" },
  ),
  quiz(
    "opening-space",
    "opening",
    "opening/space",
    "広い方へ",
    "二方向へ伸ばす余地を残す",
    space,
    [
      choice(
        "edge",
        "A8",
        false,
        "横は行き止まり",
        "左は盤端、右は白。",
        lineFrames(
          space,
          "A8",
          ["伸びる先がない"],
          [[mark("A8 B8 C8"), mark("D8", "", "danger")]],
        ),
      ),
      choice(
        "up",
        "B9",
        true,
        "二方向の余地",
        "",
        lineFrames(
          space,
          "B9",
          ["縦と斜めへ"],
          [[mark("B8 B9 C8", "B10 D7", "good")]],
        ),
      ),
    ],
    { kind: "compare" },
  ),
  quiz(
    "opening-bridge",
    "opening",
    "opening/bridge-around-blocker",
    "白をまたがずつなぐ",
    "左右の黒と、それぞれ線を共有する",
    bridge,
    [
      choice(
        "middle",
        "I9",
        true,
        "斜めでつなぐ",
        "H8とJ8、両方へ線が通る。",
        lineFrames(
          bridge,
          "I9",
          ["二本の斜め"],
          [[mark("H8 I9 J8", "G7 K7", "good")]],
        ),
      ),
      choice(
        "left",
        "G8",
        false,
        "片側だけにつながる",
        "I8の白が横を分けている。",
        lineFrames(
          bridge,
          "G8",
          ["横の白を越えられない"],
          [[mark("G8 H8"), mark("I8", "", "danger")]],
        ),
      ),
      choice(
        "right",
        "K8",
        false,
        "片側だけにつながる",
        "I8の白が横を分けている。",
        lineFrames(
          bridge,
          "K8",
          ["横の白を越えられない"],
          [[mark("J8 K8"), mark("I8", "", "danger")]],
        ),
      ),
    ],
    { kind: "compare" },
  ),
  play(
    "prevent-junction",
    "defense",
    "defense/shared-junction",
    "四になる前に",
    "白の次の二重の勝ち口を防ぐ",
    C,
    "H8",
    {
      goalKind: "prevent-fork",
      completion: "local-goal",
      judge: { kind: "prevent-fork", maxPly: 7, maxNodes: 1200 },
    },
  ),
  play(
    "prevent-changed-arm",
    "defense",
    "defense/shared-junction",
    "一石変わると",
    "白の次の二重の勝ち口を防ぐ",
    C2,
    "H8 E8 J8",
    {
      goalKind: "prevent-fork",
      completion: "local-goal",
      judge: { kind: "prevent-fork", maxPly: 7, maxNodes: 1200 },
      evidence: original(
        "prevent-junctionの一石差。異なる独立概念として数えない。",
      ),
    },
  ),
  play(
    "shared-point-order",
    "order",
    "order/shared-point",
    "どちらの四から",
    "受け石の位置を読み、勝ち切る",
    A,
    "H8",
    {
      judge: {
        kind: "win",
        maxPly: 7,
        maxNodes: 1200,
        setups: [],
        observations: [
          {
            move: parse("J8"),
            frames: aWrong,
            text: "縦のつなぎ目を取られる。",
          },
        ],
      },
    },
  ),
  play(
    "turning-attack",
    "order",
    "order/turning-vcf",
    "向きを変えて続ける",
    "相手の応手を見て、勝ち切る",
    turning,
    "F8",
    {
      judge: {
        kind: "win",
        maxPly: 9,
        maxNodes: 1600,
        setups: [],
        observations: [
          {
            move: parse("G8"),
            frames: lineFrames(
              turning,
              "G8 F8",
              ["別の四から始めると", "縦の接点を取られる"],
              [[], [mark("F8", "", "danger"), mark("F5 F6")]],
            ),
            text: "縦の四に必要なF8を取られる。",
          },
        ],
      },
    },
  ),
  quiz(
    "counter-four-claim",
    "counter",
    "counter/four-three",
    "この攻めは通るか",
    "H8から勝てるか、白の応手を読む",
    B,
    [
      choice(
        "win",
        "黒が勝ち切れる",
        false,
        "白は受けながら四",
        "J8の後は、黒がJ9を受ける番。",
        bLine,
      ),
      choice(
        "counter",
        "白の反撃で止まる",
        true,
        "白の攻めが先になる",
        "",
        bLine,
      ),
    ],
    { goalKind: "recognize-counter", completion: "local-goal" },
  ),
  quiz(
    "counter-three-claim",
    "counter",
    "counter/double-three",
    "三を二つ作った後",
    "H8に白I8。黒はどちらを先にするか",
    counterThree,
    [
      choice(
        "continue",
        "H5へ攻める",
        false,
        "白の五連が先",
        "I9を受けないと終わる。",
        lineFrames(
          counterThree,
          "H8 I8 H5 I9",
          ["黒の二方向", "受けて四", "そのまま攻めると", "白の五連"],
          [
            [],
            [mark("I5 I6 I7 I8", "I9", "danger")],
            [],
            [mark("I5 I6 I7 I8 I9", "", "danger")],
          ],
        ),
      ),
      choice(
        "block",
        "I9を受ける",
        true,
        "今は白の四を受ける",
        "三三でも、反撃を見直す。",
        lineFrames(
          counterThree,
          "H8 I8 I9 H9",
          ["黒の二方向", "受けて四", "黒が受ける", "白がもう一方を止める"],
          [
            [],
            [mark("I5 I6 I7 I8", "I9", "danger")],
            [mark("I9", "", "good")],
            [mark("H9", "", "danger")],
          ],
        ),
      ),
    ],
    { goalKind: "recognize-counter", completion: "local-goal" },
  ),
  play(
    "defend-and-attack",
    "counter",
    "counter/dual-duty-defense",
    "受けた後が勝負",
    "白の四を受け、そのまま勝ち切る",
    dual,
    "F8",
  ),
  play(
    "two-direction-fork",
    "branch",
    "branch/double-three",
    "応手に合わせて",
    "二方向の攻めを使い分け、勝ち切る",
    D,
    "H8",
    {
      judge: {
        kind: "win",
        maxPly: 7,
        maxNodes: 1200,
        setups: [setup("H8", "E8 H9 I8 H5")],
        observations: [],
      },
      evidence: original("H8後の白216合法応手と46,224の次応手を独立検証。"),
    },
  ),
  play(
    "quiet-two-plans",
    "prepare",
    "prepare/quiet-dual-vcf",
    "攻め始める前に",
    "次の攻めを準備し、応手ごとに勝ち切る",
    quiet,
    "H8 F8",
    {
      judge: {
        kind: "win",
        maxPly: 9,
        maxNodes: 1600,
        setups: [
          setup("H8", "H10 F8 K13 H9 G9"),
          setup("F8", "H10 G8 H8 F9 K13"),
        ],
        observations: [],
      },
      evidence: original(
        "H8/F8とも初手後の白208合法応手で、7半手以内の勝ちを独立検証。",
      ),
    },
  ),
  quiz(
    "quiet-shape",
    "prepare",
    "prepare/quiet-dual-vcf",
    "H8で何が変わるか",
    "今できる形と、次の狙いを区別する",
    quiet,
    [
      choice(
        "four",
        "今すぐ四ができる",
        false,
        "まだ四ではない",
        "次に使う二つの攻めを準備する。",
        quietLine,
      ),
      choice(
        "three",
        "今すぐ両端四にできる",
        false,
        "一手の準備が先",
        "H8の直後には、両端四を作れない。",
        quietLine,
      ),
      choice(
        "prepare",
        "次の攻めを二つ用意する",
        true,
        "応手で使い分ける",
        "",
        quietLine,
      ),
    ],
  ),
];

const records = [
  {
    id: "practical-center",
    sourceId: "max-natural",
    ply: 38,
    title: "実戦・中央から右辺",
    guide: "N8",
    moves:
      "H8 G7 G6 H7 F7 E8 I6 H6 I5 H5 I7 H4 H3 I8 K6 I4 K5 J6 K4 K3 L5 J5 M6 J3 N7 O8 J4 L3 N3 I3 M3 M4 N5 K2 L1 K8 N6 N4",
  },
  {
    id: "practical-contact",
    sourceId: "max-white-h7",
    ply: 30,
    title: "実戦・接触戦の続き",
    guide: "H5",
    moves:
      "H8 H7 G6 H6 F7 E8 G8 G7 I5 E9 I7 I8 J6 K5 F8 G9 H4 G3 I4 F9 H9 E6 E7 C9 D9 D7 I3 I6 G5 F6",
  },
  {
    id: "practical-space",
    sourceId: "max-white-h6",
    ply: 24,
    title: "実戦・離れた石を使う",
    guide: "E9",
    moves:
      "H8 H6 G8 F8 G7 G6 F6 I9 E7 E6 D8 C9 F10 G9 E5 D4 F5 H5 F7 D7 F4 F3 C7 G3",
  },
];
for (const r of records)
  bank.push(
    play(
      r.id,
      "practice",
      `record/${r.sourceId}`,
      r.title,
      "盤全体から勝ち筋を見つけ、最後まで指す",
      fromRecord(r.moves),
      r.guide,
      {
        sourceMoves: points(r.moves).map((i, n) => ({ i, side: (n % 2) + 1 })),
        evidence: {
          source: "record",
          sourceId: r.sourceId,
          scope: `元棋譜の${r.ply}手終了局面。黒勝ち3棋譜の一場面。全局の最善手を主張しない。`,
          verification: "自分のRapfi実戦棋譜。後続VCFを独立検証。",
        },
      },
    ),
  );

const hintTextByUnit = {
  priority: [
    "自分と白の五連になる点を、両方探す。",
    "白を受ける前に、自分がこの一手で勝てるか見る。",
    "自分が勝てるなら五連へ。勝てないなら白の完成点を塞ぐ。",
  ],
  conditions: [
    "三の両隣だけでなく、その外側も見る。",
    "四へ伸ばした後、空いている端を数える。",
    "相手の石や盤端で、片側が止まっていないか確かめる。",
  ],
  opening: [
    "今ある黒石と、同じ縦・横・斜めにつながる候補を探す。",
    "白が一方向を塞いだ後に残る、もう一方向を見る。",
    "候補の後の白の一手まで比べ、残る連携を選ぶ。",
  ],
  defense: [
    "自分の攻めより先に、白が次に作る形を読む。",
    "白の二方向の攻めが交わる空点を探す。",
    "印の候補から、白の次の二重攻撃が消える手を選ぶ。",
  ],
  order: [
    "四を作る候補を二つ見つける。",
    "白が受けた石を置き、その後の別方向を見る。",
    "印の候補は、白に受けさせた後も別の四を残す。",
  ],
  counter: [
    "相手が受ける点の周りにも石が集まっていないか見る。",
    "受けた白石で四ができると、次は黒が受ける番になる。",
    "予定の攻めを続けた時、白が先に五連にできないか確認する。",
  ],
  branch: [
    "一つの石から二方向につながる場所を探す。",
    "白に片側を止められても、反対の方向に四を作れるか見る。",
    "印の点を使い、白の応手の後は残った方向を選ぶ。",
  ],
  prepare: [
    "すぐ四にできなくても、石を結ぶ準備手を探す。",
    "下側と上側のどちらを白が止めても、攻めが残るか比べる。",
    "印の二候補は、別々の白応手にも続きの勝ちがある。",
  ],
  practice: [
    "離れた場所も含め、四にできる点を探す。",
    "白の受け石の後に、次の四や二つの勝ち口が残るか読む。",
    "印の候補から、相手の応手を見て最後まで続ける。",
  ],
};
bank.forEach((p) => {
  p.hintTexts ||= hintTextByUnit[p.unitId];
});
const choiceHints = {
  "closed-three": [
    [mark("G8 H8 I8")],
    [mark("E8 K8", "", "danger")],
    [mark("G8 H8 I8", "F8 J8")],
  ],
  "edge-space": [
    [mark("A8 B8 D8")],
    [mark("A8 B8 D8", "C8")],
    [mark("A8 B8 D8", "C8 E8")],
  ],
  "opening-two-plans": [
    [mark("G8 H8")],
    [mark("G8 H8", "F8 G9")],
    [mark("G8 H8", "G9 G10 I7")],
  ],
  "opening-space": [
    [mark("B8 C8")],
    [mark("D8 C9", "", "danger")],
    [mark("B8 C8", "A8 B9")],
  ],
  "opening-bridge": [
    [mark("H8 J8")],
    [mark("I8", "", "danger")],
    [mark("H8 J8", "I9 I7")],
  ],
  "counter-four-claim": [
    [mark("F8 G8 I8 H7 H9", "H8")],
    [mark("J5 J6 J7", "J8", "danger")],
    [mark("J5 J6 J7", "J8 J9", "danger"), mark("E3 F4 G5", "H6", "danger")],
  ],
  "counter-three-claim": [
    [mark("F8 G8 H6 H7", "H8")],
    [mark("I5 I6 I7", "I8", "danger")],
    [mark("I5 I6 I7", "I8 I9", "danger")],
  ],
  "quiet-shape": [
    [mark("D8 E8 F6 F7 H11 H12 I11 J12")],
    [mark("D8 E8 F6 F7"), mark("H11 H12 I11 J12")],
    [mark("D8 E8 F6 F7 H11 H12 I11 J12", "H8 F8 H10")],
  ],
};
bank.forEach((p) => {
  if (choiceHints[p.id]) p.hintStages = choiceHints[p.id];
});
bank.find((p) => p.id === "quiet-shape").hintTexts = [
  "H8を置いた後、同じ線の石の数だけでなく空点も見る。",
  "H8の直後に、五連の点や両端四になる点があるか調べる。",
  "F8側とH10側へ、もう一手かけて攻めを始める形になっている。",
];

const unitDefs = [
  [
    "priority",
    "勝ちを先に見る",
    "自分と相手の勝ち口を比べる",
    [
      frame(
        race,
        "どちらも四",
        "自分と相手に四がある。黒番なので、白の四を止める前に自分の五連を完成させる。",
        [
          mark("F8 G8 H8 I8", "E8 J8", "good"),
          mark("F5 G5 H5 I5", "E5 J5", "danger"),
        ],
      ),
      ...lineFrames(
        race,
        "J8",
        ["黒が先に五連"],
        [[mark("F8 G8 H8 I8 J8", "", "good")]],
      ),
      ...priorityDefenseFrames,
    ],
  ],
  [
    "conditions",
    "形の条件",
    "外側と盤端まで確かめる",
    [
      frame(
        room,
        "左右の余地を比べる",
        "F8とJ8はどちらも四になるが、E8の白で左側の余地が違う。伸ばした後の両端まで比べる。",
        [mark("G8 H8 I8", "F8 J8")],
      ),
      ...lineFrames(
        room,
        "F8 J8",
        ["左へ延ばすと", "一か所で止まる"],
        [[], [mark("E8 J8", "", "danger")]],
      ),
      ...lineFrames(
        room,
        "J8",
        ["右なら両端が残る"],
        [[mark("G8 H8 I8 J8", "F8 K8", "good")]],
      ),
    ],
  ],
  [
    "opening",
    "序盤の連携",
    "相手に応じて、次の方向を残す",
    [
      frame(
        opening,
        "次の二方向",
        "一本を延ばすだけでなく、二つの方向へつながる点を探す。白が一方を塞いだ後に、何が残るかを見る。",
        [mark("G8 H8")],
      ),
      ...openingG9,
    ],
  ],
  [
    "defense",
    "四になる前に",
    "相手の次の強い交点を消す",
    [
      frame(
        C,
        "白の次を読む",
        "今は白の四がないが、H8で縦横の四が同時にできる。自分の三を作る前に、その交点を消す必要がある。",
        [mark("H5 H6 H7 F8 G8 I8", "", "danger")],
      ),
      ...cWrong.slice(0, 2),
      ...cRight,
    ],
  ],
  [
    "order",
    "四の順序",
    "相手の受け石まで使って読む",
    [
      frame(
        A,
        "二つの四を比べる",
        "横を四にする二つの候補がある。白が受ける点によって、その後の縦の攻めが残るか変わる。",
        [mark("F8 G8 I8 H7 H9", "H8 J8")],
      ),
      ...aWrong,
      ...aGood.slice(0, 3),
    ],
  ],
  [
    "counter",
    "相手の反撃",
    "受けた石が作る四を見直す",
    [
      frame(
        B,
        "四三なら勝てるか",
        "黒H8は四三に見えるが、白が受けるJ8で何ができるかを見る。受ける石が反撃の四になることがある。",
        [mark("F8 G8 I8 H7 H9")],
      ),
      ...bLine,
    ],
  ],
  [
    "branch",
    "方向を切り替える",
    "塞がれた方向の反対を使う",
    [
      frame(
        D,
        "二方向を一手でつなぐ",
        "横と縦に二つずつある黒石を、一手でつなぐ。白が塞いだ方ではなく、残った方向を使う。",
        [mark("F8 G8 H6 H7")],
      ),
      ...dLine,
    ],
  ],
  [
    "prepare",
    "静かな準備",
    "三や四を作る前に、攻めを組む",
    [
      frame(
        quiet,
        "まだ四はない",
        "今は四を作れる手がない。散らばった石をつなぎ、白が一方を止めても別の攻めが残る準備をする。",
        [mark("D8 E8 F6 F7 H11 H12 I11 J12")],
      ),
      ...quietLine,
    ],
  ],
  [
    "practice",
    "実戦で見つける",
    "型の名前なしで、盤全体から選ぶ",
    [
      frame(
        turning,
        "受け石で向きを変える",
        "相手をどこに受けさせると、次の方向につながるか読む。実戦問題でも同じように、盤全体から使える石を拾う。",
        [mark("C8 D8 E8 F5 F6 G7 H7")],
      ),
      ...turnLine,
    ],
  ],
];
function freeze(x) {
  if (x && typeof x === "object" && !Object.isFrozen(x)) {
    Object.values(x).forEach(freeze);
    Object.freeze(x);
  }
  return x;
}
export const problems = freeze([...bank, ...assessmentProblems]);
const prerequisites = {
  priority: [],
  conditions: ["priority"],
  opening: ["conditions"],
  defense: ["conditions", "opening"],
  order: ["conditions", "opening"],
  counter: ["order", "defense"],
  branch: ["counter"],
  prepare: ["order", "branch"],
  practice: ["defense", "counter", "prepare"],
};
export const units = freeze(
  unitDefs.map(([id, title, goal, lessonFrames]) => ({
    id,
    title,
    goal,
    prerequisites: prerequisites[id],
    problemIds: bank.filter((p) => p.unitId === id).map((p) => p.id),
    lessonFrames,
  })),
);
