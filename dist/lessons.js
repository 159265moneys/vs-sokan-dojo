import { parse, coord } from "./game.js";
const p = (s) => s.split(" ").filter(Boolean).map(parse);
export const lessons = [
  {
    id: "five",
    tag: "01 / 決め切る",
    name: "五連は、今つくる。",
    short: "勝ちを逃さない",
    black: "H8 I8 J8 K8",
    white: "G8 A1 C1 E1",
    steps: [
      {
        move: "L8",
        title: "五つ目を置く",
        text: "相手の形より、自分の即勝ちが最優先。",
        marks: "L8",
      },
    ],
    answers: "L8",
    theme: "finish",
  },
  {
    id: "block",
    tag: "02 / 守る",
    name: "四は、放置しない。",
    short: "必須の一手",
    black: "F8 H7 J6 L5",
    white: "G8 H8 I8 J8",
    steps: [
      {
        move: "K8",
        title: "勝ち口を閉じる",
        text: "白の次の一手はK8。ここで止める。",
        marks: "K8",
      },
    ],
    answers: "K8",
    theme: "defense",
  },
  {
    id: "openfour",
    tag: "03 / 両端を残す",
    name: "両方は、止められない。",
    short: "両端が空いた四",
    black: "G8 H8 I8",
    white: "A1 C1 E1",
    steps: [
      {
        move: "J8",
        title: "両端が空いた四",
        text: "F8とK8。白は一手で両方を塞げない。",
        marks: "F8 K8",
      },
      {
        move: "K8",
        title: "白は片側を止める",
        text: "反対側が残る。どちらを止めても同じ。",
        marks: "F8",
      },
      {
        move: "F8",
        title: "残った側で五連",
        text: "白のミスを必要としない、確定の勝ち。",
        marks: "F8",
      },
    ],
    answers: "F8 J8",
    theme: "fork",
  },
  {
    id: "doublefour",
    tag: "04 / 二方向で攻める",
    name: "ひとつの石で、二つの四。",
    short: "四四をつくる",
    black: "F8 G8 I8 H6 H7 H9",
    white: "A1 C1 E1 A3 C3 E3",
    steps: [
      {
        move: "H8",
        title: "交点に置く",
        text: "横と縦の四が同時に生まれる。禁手なしなら使える。",
        marks: "E8 J8 H5 H10",
      },
      {
        move: "J8",
        title: "白が横を止めても",
        text: "縦の勝ち口も、横の反対側も残る。",
        marks: "E8 H5 H10",
      },
      {
        move: "H10",
        title: "縦で五連",
        text: "相手が先に五連をつくれないことも確認する。",
        marks: "H10",
      },
    ],
    answers: "H8",
    theme: "fork",
  },
  {
    id: "chain",
    tag: "05 / 応手を強制する",
    name: "四、四、そして五。",
    short: "四追いの連鎖",
    black: "H6 H7 H9 G8 I8",
    white: "H5 A1 C1 E1 A3",
    steps: [
      {
        move: "H8",
        title: "まず縦の四",
        text: "白はH10を塞がないと、次に負ける。",
        marks: "H10",
      },
      {
        move: "H10",
        title: "白の応手を限定",
        text: "守らせた間に、横の三が残る。",
        marks: "F8 J8",
      },
      {
        move: "F8",
        title: "横に両端の空いた四",
        text: "E8とJ8の二つが勝ち口になる。",
        marks: "E8 J8",
      },
      {
        move: "J8",
        title: "白は一方しか守れない",
        text: "もう一方で五連を完成させる。",
        marks: "E8",
      },
      {
        move: "E8",
        title: "連続した四で勝つ",
        text: "これが四追い。相手の自由な攻め手を奪う。",
        marks: "E8",
      },
    ],
    answers: "H8",
    theme: "chain",
  },
  {
    id: "outside",
    tag: "06 / 盤面全体を見る",
    name: "その形、今は使えない。",
    short: "離れた四を見落とすな",
    black: "F8 G8 I8 H6 H7 H9 A2",
    white: "B2 C2 D2 E2 A4 C4 E4",
    steps: [
      {
        move: "F2",
        title: "先に遠くの四を止める",
        text: "H8の四四より、白のF2の五連が一手早い。",
        marks: "F2",
      },
    ],
    answers: "F2",
    theme: "defense",
  },
  {
    id: "overline",
    tag: "07 / 禁手なしを使う",
    name: "六つでも、勝ち。",
    short: "長連も有効",
    black: "E8 F8 G8 I8 J8",
    white: "A1 C1 E1 A3 C3",
    steps: [
      {
        move: "H8",
        title: "空いた交点をつなぐ",
        text: "このルールでは六連以上も勝ち。三三・四四も合法。",
        marks: "H8",
      },
    ],
    answers: "H8",
    theme: "finish",
  },
].map((l) => ({
  ...l,
  black: p(l.black),
  white: p(l.white),
  answers: p(l.answers),
  steps: l.steps.map((s) => ({ ...s, i: parse(s.move), marks: p(s.marks) })),
}));
export function lessonBoard(l, step = 0) {
  const b = new Uint8Array(225);
  l.black.forEach((i) => (b[i] = 1));
  l.white.forEach((i) => (b[i] = 2));
  l.steps.slice(0, step).forEach((s, j) => (b[s.i] = (j % 2) + 1));
  return b;
}
export function transformPoint(i, t) {
  let x = (i % 15) - 7,
    y = Math.floor(i / 15) - 7;
  if (t >= 4) x = -x;
  for (let k = 0; k < t % 4; k++) [x, y] = [-y, x];
  return (y + 7) * 15 + x + 7;
}
export function makePuzzle(l, t) {
  const board = new Uint8Array(225);
  lessonBoard(l).forEach((c, i) => {
    if (c) board[transformPoint(i, t)] = c;
  });
  return {
    lesson: l,
    transform: t,
    board,
    answers: l.answers.map((i) => transformPoint(i, t)),
    label: l.short,
  };
}
export const moveLabel = coord;
