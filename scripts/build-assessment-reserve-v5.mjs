import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  compileProblem,
  evaluateProblem,
  fingerprint,
  same,
  coord,
  axes,
  five,
} from "./reserve-oracle-v5.mjs";
import { freshDescriptor } from "./reserve-descriptors-v5.mjs";
import { reserveDiagnostic } from "./reserve-novelty-v5.mjs";

const clone = (x) => JSON.parse(JSON.stringify(x)),
  names = (a) => a.map(coord).join("・");
const point = (i) => Number.isInteger(i) && i >= 0 && i < 225;
const validBoard = (board) =>
  Array.isArray(board) &&
  board.length === 225 &&
  board.every((stone) => stone === 0 || stone === 1 || stone === 2);
const structuralPredictionKeys = new Set([
  "kind",
  "move",
  "candidate",
  "reply",
  "support",
  "focusCells",
  "arms",
  "whiteDistance",
]);
const freeze = (v) => {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    for (const x of Object.values(v)) freeze(x);
    Object.freeze(v);
  }
  return v;
};
function sourceProblem(t) {
  return {
    id: t.id,
    unitId: t.unitId,
    family: t.family,
    assessmentDomain: t.domain,
    board: [...t.board],
    prediction: clone(t.prediction),
    nodes: [
      {
        choices: [
          {
            correct: true,
            continuations: t.exercise ? [clone(t.exercise)] : undefined,
          },
        ],
      },
    ],
  };
}
export function reconstructReserveRecipe(entry, templates) {
  if (!entry || typeof entry.id !== "string") return null;
  const id = entry.id,
    t = templates[entry.source];
  if (
    !t ||
    t.id !== entry.source ||
    !validBoard(t.board) ||
    !t.prediction ||
    Object.keys(t.prediction).some(
      (key) => !structuralPredictionKeys.has(key),
    ) ||
    !entry.certificate ||
    entry.edit?.source !== entry.source ||
    entry.edit?.recipe !== entry.recipe ||
    t.domain !== entry.domain
  )
    return null;
  const p = sourceProblem(t),
    edit = entry.edit;
  if (entry.recipe === "local-edit1") {
    const { side, from, to } = edit;
    const expected = `gen-v5-${side === 2 ? "relocate1" : "local-edit1"}:${entry.source}:${side === 2 ? "w" : "b"}${from}-${to}`;
    if (
      id !== expected ||
      ![1, 2].includes(side) ||
      !point(from) ||
      !point(to) ||
      from === to ||
      p.board[from] !== side ||
      p.board[to] ||
      to === (p.prediction.candidate ?? p.prediction.move) ||
      to === p.prediction.reply
    )
      return null;
    p.board[from] = 0;
    p.board[to] = side;
    if (side === 1) {
      const map = (i) => (i === from ? to : i);
      for (const key of ["support", "focusCells"])
        if (p.prediction[key]) p.prediction[key] = p.prediction[key].map(map);
      if (p.prediction.arms)
        p.prediction.arms = p.prediction.arms.map((a) => a.map(map));
      for (const ex of p.nodes[0].choices[0].continuations || [])
        ex.cells = ex.cells.map(map);
    }
  } else if (
    entry.recipe === "counter-ray1" ||
    entry.recipe === "counter-clear-ray1"
  ) {
    const family = { 0: "straight-reply", 3: "diagonal-attack" }[edit.seed];
    const domain = entry.recipe === "counter-ray1" ? "threat" : "clear";
    if (
      !family ||
      !Number.isInteger(edit.seed) ||
      entry.source !== `check-counter-v5-${family}-${domain}` ||
      !Number.isInteger(edit.direction) ||
      edit.direction < 0 ||
      edit.direction > 3 ||
      !Number.isInteger(edit.mask) ||
      edit.mask < 0 ||
      edit.mask > 255 ||
      edit.mask.toString(2).replaceAll("0", "").length !== 3 ||
      id !==
        `gen-v5-${entry.recipe}-s${edit.seed}-d${edit.direction}-m${edit.mask.toString(16).padStart(2, "0")}`
    )
      return null;
    const r = p.prediction.reply,
      [dx, dy] = axes[edit.direction],
      offsets = [-4, -3, -2, -1, 1, 2, 3, 4];
    p.board = p.board.map((s) => (s === 1 ? 1 : 0));
    for (let k = 0; k < 8; k++)
      if (edit.mask & (1 << k)) {
        const x = (r % 15) + offsets[k] * dx,
          y = Math.floor(r / 15) + offsets[k] * dy;
        if (x < 0 || x >= 15 || y < 0 || y >= 15 || p.board[y * 15 + x])
          return null;
        p.board[y * 15 + x] = 2;
      }
  } else return null;
  const fact = evaluateProblem(compileProblem(p), [...p.board]);
  if (
    !fact ||
    fact.domain !== entry.domain ||
    fingerprint(p.board) !== entry.positionFingerprint ||
    !same(fact.accepted, entry.certificate.accepted) ||
    !same(fact.finishes || [], entry.certificate.finishes) ||
    fact.outcome !== entry.certificate.outcome
  )
    return null;
  if (reserveDiagnostic(p, fact).signature !== entry.semanticFingerprint)
    return null;
  return { entry, p, fact };
}

function winningStones(board, side, completions) {
  return [
    ...new Set(
      five
        .filter(
          ({ cells }) =>
            cells.some((i) => completions.includes(i)) &&
            cells.filter((i) => board[i] === side).length === 4 &&
            cells.every((i) => board[i] !== 3 - side),
        )
        .flatMap(({ cells }) => cells.filter((i) => board[i] === side)),
    ),
  ];
}
function resultHighlights(problem, fact, reason, board) {
  const marks = [];
  const add = (cells = [], points = [], tone = "focus") => {
    const mark = {
      cells: [...new Set(cells)].filter((i) => point(i) && board[i]),
      points: [...new Set(points)].filter((i) => point(i) && !board[i]),
      tone,
    };
    if (mark.cells.length || mark.points.length) marks.push(mark);
  };
  const prediction = problem.prediction;
  if (problem.unitId === "conditions") {
    add(prediction.focusCells, fact.finishes, "good");
    add(reason.blockers, [], "danger");
  } else if (problem.unitId === "counter") {
    if (fact.finishes.length) {
      add(winningStones(board, 2, fact.finishes), fact.finishes, "danger");
    } else {
      const maximum = Math.max(
        ...reason.supportProfiles.map((profile) => profile.maximumSupport),
      );
      add([
        prediction.reply,
        ...reason.supportProfiles
          .filter((profile) => profile.maximumSupport === maximum)
          .flatMap((profile) => profile.supportSets.flat()),
      ]);
    }
  } else if (problem.unitId === "branch") {
    const example = reason.example;
    add(prediction.support, example ? [example.move] : []);
    if (example) add([], example.completions, "good");
    add(
      reason.blockedWindows.flatMap((window) => window.blockers),
      [],
      "danger",
    );
  } else if (problem.unitId === "prepare") {
    add(
      [...prediction.support, prediction.candidate],
      reason.followups.map((item) => item.move),
    );
    add(
      reason.blockedWindows.flatMap((window) => window.blockers),
      [],
      "danger",
    );
  } else if (problem.unitId === "opening") {
    add([...prediction.support, prediction.candidate]);
    add(
      reason.arms
        .filter((arm) => !arm.windows.length)
        .flatMap((arm) =>
          arm.between.length
            ? arm.between
            : arm.blocked.flatMap((window) => window.blockers),
        ),
      [],
      "danger",
    );
  } else if (fact.outcome === "win") {
    add(winningStones(board, 1, fact.blackWins), fact.blackWins, "good");
    add(winningStones(board, 2, fact.whiteWins), fact.whiteWins, "danger");
  } else if (fact.outcome === "defense") {
    if (fact.whiteWins.length)
      add(winningStones(board, 2, fact.whiteWins), fact.whiteWins, "danger");
    else
      for (const threat of reason.whiteForks) {
        const after = [...board];
        after[threat.move] = 2;
        add(
          winningStones(after, 2, threat.completions).filter(
            (i) => board[i] === 2,
          ),
          [threat.move, ...threat.completions],
          "danger",
        );
      }
  } else {
    add(
      reason.example.arms.map((arm) => arm.support),
      [reason.example.move],
    );
  }
  return marks;
}

export function buildReserveProblem(entry, templates) {
  const id = entry.id,
    v = reconstructReserveRecipe(entry, templates);
  if (!v) throw Error(`Invalid reserve recipe: ${id}`);
  const { p, fact } = v,
    pr = p.prediction,
    unit = p.unitId,
    c = pr.candidate ?? pr.move,
    r = pr.reply,
    board = p.board,
    exercise = p.nodes[0].choices[0].continuations?.[0];
  let choices,
    outcome = fact.outcome,
    goal,
    title =
      unit === "practice"
        ? "局面を読む"
        : unit === "counter"
          ? "白の受けを読む"
          : unit === "conditions"
            ? "形を確かめる"
            : "続きを考える",
    text,
    resultTitle,
    frames = [],
    prediction = clone(pr),
    fresh = freshDescriptor(p, fact);
  text = fresh.text;
  prediction.reason = fresh.reason;
  prediction.comparisonGroup = `generated/${entry.recipe}/${entry.source}`;
  if (unit === "conditions") {
    const count = fact.finishes.length;
    prediction.completionPoints = [...fact.finishes];
    prediction.blockers = fresh.blockers;
    prediction.boundary = fresh.boundary;
    if (pr.kind === "open-four") {
      choices = [
        ["yes", "両端四になる"],
        ["no", "両端四にならない"],
      ];
      goal = `${coord(c)}に黒を置くと、両端四になる？`;
      resultTitle = count >= 2 ? "両端四になる" : "両端四にはならない";
    } else {
      choices = [
        ["zero", "0か所"],
        ["one", "1か所"],
        ["two", "2か所以上"],
      ];
      goal = `${coord(c)}に黒を置くと、完成点はいくつ？`;
      resultTitle = `完成点は${count}か所`;
    }
    const after = [...board];
    after[c] = 1;
    frames = [
      {
        board: after,
        last: c,
        title: resultTitle,
        text,
        highlights: [
          {
            cells: prediction.focusCells.filter((i) => after[i] === 1),
            points: fact.finishes,
            tone: "good",
          },
        ],
      },
    ];
  } else if (unit === "counter") {
    choices = [
      ["open-four", "2つ以上"],
      ["four", "1つ"],
      ["clear", "なし"],
    ];
    goal = "印の黒手に白が受けると、白の完成点は？";
    prediction.whiteFinishes = [...fact.finishes];
    prediction.outcome = outcome;
    resultTitle =
      fact.finishes.length > 1
        ? "受けが活四になる"
        : fact.finishes.length
          ? "受けが四になる"
          : "受けても四にならない";
    const b = [...board];
    b[c] = 1;
    frames.push({
      board: [...b],
      last: c,
      title: `仮想手順：黒${coord(c)}`,
      text: `黒の完成点は${coord(r)}。`,
      highlights: [
        { cells: winningStones(b, 1, [r]), points: [r], tone: "focus" },
      ],
    });
    b[r] = 2;
    frames.push({
      board: [...b],
      last: r,
      title: `仮想手順：白${coord(r)}`,
      text,
      highlights: [
        {
          cells: [],
          points: fact.finishes,
          tone: fact.finishes.length ? "danger" : "focus",
        },
      ],
    });
  } else {
    const labels = {
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
    choices = labels[unit];
    prediction.outcome = outcome;
    resultTitle = choices.find((x) => x[0] === outcome)[1];
    const prefix = c == null ? "" : `黒${coord(c)}→白${coord(r)}の後、`;
    goal =
      unit === "branch"
        ? `${prefix}${names(pr.support)}から完成点を2つ作れる？`
        : unit === "prepare"
          ? `${prefix}黒${coord(c)}を使う活三は何方向に作れる？`
          : unit === "opening"
            ? `${prefix}印の黒手は2方向へつながる？`
            : "次の一手を選ぶ";
    const b = [...board];
    for (const move of exercise.moves) {
      b[move.i] = move.side;
      frames.push({
        board: [...b],
        last: move.i,
        title: `${move.side === 1 ? "黒" : "白"}${coord(move.i)}`,
        text: "",
        highlights: [{ cells: [move.i], points: [], tone: "focus" }],
      });
    }
    frames.push({
      board: [...b],
      last: null,
      title: resultTitle,
      text,
      highlights: [],
    });
  }
  for (const frame of frames)
    if (
      frame.last === null ||
      unit === "conditions" ||
      (unit === "counter" && frame.last === r)
    ) {
      frame.highlights = resultHighlights(p, fact, fresh.reason, frame.board);
    }
  const supports = (pr.support || pr.focusCells || []).filter(
      (i) => board[i] === 1,
    ),
    initial =
      unit === "practice"
        ? []
        : [
            {
              cells: ["branch", "prepare", "opening"].includes(unit)
                ? supports
                : [],
              points: [c],
              tone: "focus",
            },
          ];
  const supportHints = resultHighlights(p, fact, fresh.reason, board)
    .map((mark) => ({ ...mark, points: [] }))
    .filter((mark) => mark.cells.length);
  if (unit === "counter") {
    const cells = [
      ...new Set(
        fresh.reason.supportProfiles.flatMap((profile) =>
          profile.supportSets.flat(),
        ),
      ),
    ];
    if (cells.length) supportHints.push({ cells, points: [], tone: "focus" });
  }
  const answerHints = [
    ...supportHints,
    {
      cells: [],
      points: [
        ...new Set(unit === "conditions" ? fact.finishes : fact.accepted),
      ].filter((i) => !board[i]),
      tone: "focus",
    },
  ];
  let continuation;
  if (exercise) {
    const titles = {
      five: "五連にする",
      "prevent-fork": "白の狙いを消す",
      "safe-four": "白に受け四を与えない四を作る",
      "open-four": `${names(exercise.cells)}から完成点を2つ`,
      "open-three": `${names(exercise.cells)}を使い、両端四につながる三`,
      "two-directions": `${names(exercise.cells)}へ2方向でつなぐ`,
    };
    continuation = { ...clone(exercise), title: titles[exercise.objective] };
  }
  return freeze({
    id,
    role: "assessment",
    supply: "reserve",
    unitId: unit,
    skillId: unit,
    family: p.family,
    branchId: entry.recipe,
    assessmentDomain: fact.domain,
    requiresBranch: false,
    title,
    goal,
    kind: "compare",
    goalKind: unit === "counter" ? "compare-counter" : "compare-plan",
    completion: unit === "conditions" ? "comparison" : "local-goal",
    board: [...board],
    sideToMove: 1,
    rootNodeId: "start",
    questionHighlights: initial,
    hintTexts:
      unit === "counter"
        ? [
            "印の黒手から、黒の完成点を探す。",
            "そこへ白が受けた後の各方向を見る。",
            "白の完成点を重複せずに数える。",
          ]
        : unit === "practice"
          ? [
              "黒の即五連を探す。",
              "白の即五連と次の二完成点を調べる。",
              "検査した狙いがなければ配置をつなぐ。",
            ]
          : [
              "指定の黒石と手を確認する。",
              "白石と盤端で区切られた線を見る。",
              "空点と方向を重複せずに数える。",
            ],
    hintStages: [initial, supportHints, answerHints],
    prediction,
    guide: [...fact.accepted],
    judge: { kind: "compare" },
    nodes: [
      {
        id: "start",
        input: "choice",
        hints: [],
        choices: choices.map(([choiceId, label]) => ({
          id: choiceId,
          title: label,
          correct: choiceId === outcome,
          resultTitle,
          text,
          frames,
          ...(choiceId === outcome && continuation
            ? { continuations: [continuation] }
            : {}),
        })),
      },
    ],
    evidence: {
      source: "original",
      sourceId: null,
      scope:
        "指定局面の有限目標と合法な本人入力を検算。全局の最善・必勝は認定しない。",
      verification: `scripts/reserve-oracle-v5.mjs; tests/assessment-reserve-v5.test.mjs; ${entry.recipe}`,
    },
  });
}

export function loadReserveSources() {
  const recipes = JSON.parse(
    readFileSync(
      new URL("../data/generated-assessment-recipes-v5.json", import.meta.url),
      "utf8",
    ),
  );
  const templates = JSON.parse(
    readFileSync(
      new URL(
        "../data/generated-assessment-templates-v5.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  if (recipes.schemaVersion !== 1 || templates.schemaVersion !== 1)
    throw Error("Unsupported reserve source version");
  return { recipes: recipes.recipes, templates: templates.templates };
}
export function buildReserveAssessments(input = loadReserveSources()) {
  const seen = new Set();
  return input.recipes.map((entry) => {
    if (seen.has(entry.id)) throw Error(`Duplicate reserve ID: ${entry.id}`);
    seen.add(entry.id);
    return buildReserveProblem(entry, input.templates);
  });
}
export function serializeReserveCatalog(problems) {
  const coverage = {};
  const compact = problems.map((problem) => {
    coverage[problem.assessmentDomain] =
      (coverage[problem.assessmentDomain] || 0) + 1;
    const copy = clone(problem);
    for (const node of copy.nodes) {
      node.sharedFrames = node.choices[0].frames;
      for (const choice of node.choices) {
        if (!same(choice.frames, node.sharedFrames))
          throw Error(`Frames differ: ${problem.id}`);
        delete choice.frames;
      }
    }
    return copy;
  });
  return (
    `// Generated by scripts/build-assessment-reserve-v5.mjs. Do not edit by hand.
` +
    `// Facts and every accepted move are independently checked at build/test time.
` +
    `const records = [\n${compact.map((p) => "  " + JSON.stringify(p)).join(",\n")}\n];\n` +
    `function freeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }\n` +
    `export const reserveAssessments = freeze(records.map((problem) => { for (const node of problem.nodes) { const frames = node.sharedFrames; delete node.sharedFrames; for (const choice of node.choices) choice.frames = frames; } return problem; }));\n` +
    `const byId = new Map(reserveAssessments.map((problem) => [problem.id, problem]));\n` +
    `export function resolveReserveProblem(id) { return typeof id === "string" ? byId.get(id) || null : null; }\n` +
    `export const reserveCoverage = freeze(${JSON.stringify(coverage)});\n`
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const output = new URL("../dist/assessment-reserve-v5.js", import.meta.url);
  const problems = buildReserveAssessments();
  const serialized = serializeReserveCatalog(problems);
  if (process.argv.includes("--check")) {
    if (readFileSync(output, "utf8") !== serialized)
      throw Error(
        "Reserve catalog is stale; run node scripts/build-assessment-reserve-v5.mjs",
      );
  } else writeFileSync(output, serialized);
  console.log(
    JSON.stringify({
      problems: problems.length,
      checked: process.argv.includes("--check"),
    }),
  );
}
