import { strategyChapters, strategySources } from "./strategy-article.js";
import { diagram, data } from "./strategy-diagrams.js";
import { coord } from "./game.js";

const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const pattern = /\[\[diagram:([a-z-]+):(\d+)\]\]/g;
export const strategyFigures = strategyChapters.flatMap((chapter) =>
  [...chapter.body.matchAll(pattern)].map((match) => ({
    id: match[1],
    step: Number(match[2]),
    chapter: chapter.id,
  })),
);
function recordMarkup(id) {
  const moves = data[id]?.recordMoves;
  if (!moves) throw new Error(`Missing article record: ${id}`);
  const rows = [];
  for (let i = 0; i < moves.length; i += 2) {
    rows.push(
      `<tr><th scope="row">${i + 1}${moves[i + 1] ? `–${i + 2}` : ""}</th><td>${coord(moves[i].i)}</td><td>${moves[i + 1] ? coord(moves[i + 1].i) : "—"}</td></tr>`,
    );
  }
  return `<details class="guide-record" data-guide-record="${id}"><summary>全${moves.length}手の棋譜</summary><table><thead><tr><th scope="col">手数</th><th scope="col">黒</th><th scope="col">白</th></tr></thead><tbody>${rows.join("")}</tbody></table></details>`;
}
export function strategyMarkup() {
  const contents = strategyChapters
    .map(
      (c, i) =>
        `<li><a href="#guide-${c.id}"><span>${String(i + 1).padStart(2, "0")}</span>${escape(c.title)}</a></li>`,
    )
    .join("");
  const body = strategyChapters
    .map(
      (c, i) =>
        `<section class="guide-chapter" id="guide-${c.id}" aria-labelledby="guide-heading-${c.id}"><h2 id="guide-heading-${c.id}"><span class="guide-chapter-number">${String(i + 1).padStart(2, "0")}</span>${escape(c.title)}</h2>${c.body.replace(pattern, (_, id, step) => `<div class="guide-figure" data-guide-diagram="${id}" data-guide-step="${step}">${diagram(id, { step: Number(step) })}</div>`).replace(/\[\[record:([a-z-]+)\]\]/g, (_, id) => recordMarkup(id))}</section>`,
    )
    .join("");
  return `<article class="strategy-article">
    <header class="guide-title"><span class="guide-eyebrow">攻略書</span><h1>五目並べの考え方</h1><p class="guide-lead">一手を選ぶ前に、勝ちの形と、そこまでの道筋を理解する。</p></header>
    <p>「次はどこに置く？」に答えるには、先に「何を作りたい？」「相手はどう返す？」が必要になる。この攻略書では、すぐに覚えたい見る順番から、攻めと守りのつなぎ方までを、図の変化に沿って説明する。</p>
    <p>最初は通して読み、図の黒と白を一手ずつ追ってみよう。途中で分からなくなったら、その直前の完成点へ戻ればよい。用語は初めて出る場所で説明する。</p>
    <details class="guide-toc" id="guide-contents" open><summary>目次</summary><nav aria-label="攻略書の目次"><ol>${contents}</ol></nav></details>
    <p class="guide-diagram-key">図のA・Bは候補や完成点、石の数字は例の中の手順。「局所図」は形を読むための抜粋なので、実戦では図の外の反撃も確かめる。</p>
    ${body}
    <section class="guide-sources" id="guide-sources"><h2>参考にした資料</h2><p>以下の資料を照合し、このゲームのルールに合わせて文章と図を構成した。外部の問題図や解説文の転載はしていない。</p><ol>${strategySources.map((s) => `<li id="guide-source-${s.id}"><a href="${escape(s.url)}" target="_blank" rel="noopener noreferrer">${escape(s.title)}</a><p>${escape(s.note)}</p></li>`).join("")}</ol></section>
    <a class="guide-back-top" href="#guide-contents">目次へ戻る ↑</a>
  </article>`;
}
export function strategyExposure(id, step) {
  const d = data[id],
    f = d?.frames[step];
  return f
    ? {
        board: [...f.board],
        kind: "article",
        ...(d.source?.problemId ? { problemId: d.source.problemId } : {}),
      }
    : null;
}
export function strategyRecordExposures(id) {
  const moves = data[id]?.recordMoves;
  if (!moves) return [];
  const board = Array(225).fill(0);
  const exposures = [{ board: board.slice(), kind: "article-record" }];
  for (const move of moves) {
    board[move.i] = move.color;
    exposures.push({ board: board.slice(), kind: "article-record" });
  }
  return exposures;
}
