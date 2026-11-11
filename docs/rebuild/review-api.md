# 因果の振り返り API（固定契約）

対象は `freestyle15` の実戦棋譜。評価点・CPU評価値は読み取らない。

## 公開関数

```js
import {
  scanRecord, describePosition, describeMove, judgeReviewMove,
} from './causal-review.js';

const moments = await scanRecord(record, {
  onProgress: ({done, total, moments: count}) => {},
});
const frame = describePosition(board, color = 1, {last = null} = {});
const frames = describeMove(boardBefore, point, color = 1);
const verdict = judgeReviewMove(moment, point);
```

- `board` は225要素のArray/Uint8Array。0空、1黒、2白。入力を変更しない。
- `scanRecord` はPromise。`record.moves` は既存 `{i}` または整数の列。黒の手を調べる。
- `moment.ply` は **1始まり**。対象手は `record.moves[moment.ply - 1]`。
- `describePosition` はFrameを1つ、`describeMove` は着手前後のFrame配列を返す。解説は即勝ち点・実在する四/三/接続など盤上で確認できる事実のみ。
- `moments.coverage` に解析状態を付ける。空配列は「悪手なし」の証明ではない。

```ts
type Frame = {
  board: number[225], last: number | null, title: string, text: string,
  highlights: {cells: number[], points: number[], tone: 'focus'|'danger'|'good'}[],
  facts?: object,
  claims?: object[],
};
type Moment = {
  id: string, ply: number, kind: string, title: string, text: string,
  skillId: 'priority'|'shape'|'connections'|'defense'|'order'|'counter'|'branch'|'preparation'|'real',
  before: number[225], actual: number, alternatives: number[],
  frames: Frame[], improvementFrames: Frame[],
  scope: 'immediate-win'|'forced-win'|'line-prevented',
  evidence: object, alternativeDetails: object[],
};
type Verdict = {
  status: 'correct'|'alternative'|'refuted'|'unknown'|'illegal',
  accepted: boolean, title: string, text: string,
  scope: 'immediate-win'|'forced-win'|'line-prevented'|'unknown',
  frames: Frame[],
};
```

`correct` は掲載の第1候補、`alternative` は別の検証済み候補。`line-prevented` は「示した勝ち筋を消す」であり全局の勝ち・互角・安全の保証ではない。未掲載手もその場で再検査し、反証のない手を不正解と決めつけない。

## Worker

```text
受信 {type:'scan', id, record}
送信 {type:'progress', id, done, total, moments}
送信 {type:'result', id, moments, coverage}
送信 {type:'error', id, error}
```

Workerは `new Worker('/review-worker.js', {type:'module'})`。CPU対戦engineとは独立。複数依頼を識別するため画面はid一致を確認する。途中中止はroot側でworker.terminate()し再生成する。

## 検証と表示

初手が即勝ちを逃す、即受けを逃す、白の達四/四四を許す、逆四を許す、証明済み四追いから負ける手へ変える、を優先する。相手の勝ち点が既に2つあって自分に即勝ちがない手は責めない。回避策を示せない未確定の場面を「敗着」にしない。

`coverage` は `total`（棋譜手数）、`scannedBlackMoves`、`unknownPlies`、`unavoidablePlies`、`provenMoments`、`complete`、`scope` を持つ。`complete:true` は指定範囲の走査完了であり、全局最善手解析の完了ではない。UIは結果0件でも「確認できた場面なし」等とし、「見落としなし」と表示しない。

`highlights.cells` は型の構成石、`points` は空の完成・継続点。両者を混ぜない。各Frameの盤を使って再生する。

## 説明の根拠

説明は専門名称だけで終えず、完成点と応手の結果を2文程度で示す。例：

- 「白E8で、両端が空いた四になります。黒がD8を止めても、I8で五が完成します。」
- 「黒の三に対し、白F8は先に四を作ります。黒はG8を守る必要があり、そこから白の四が続きます。」
- 「白がE8で攻め始める前に、黒がその点を取ります。白は予定の場所に置けなくなります。」

証明手順の防御フレームは、その手の前の完成点と後に残る完成点を比較する。「一方を止めても別の点が残る」「完成点が一度なくなる」「受ける手が逆の四を作る」を区別する。

改善が局所的な防御の場合、相手の予定着手点の先取り、予定完成点の先取り、途中で四を作れなくする妨害、こちらの四による反撃、のどれかを `alternativeDetails[].obstruction` に保持する。元の手順の応手点が変化しただけで妨害の意味を証明できない場合は改善扱いせず、`unknown` にする。

`Frame.claims` は説明の機械検査用。`two-completions`、`must-block`、`blocked-but-remains`、`completion-removed`、`completed-five`、`occupied-plan-point`、`no-completion` を使う。盤の完成点集合、前後盤の受け点、本文中の座標との整合をテストしている。画面にclaimsを表示する必要はない。

実装既定値はVCF 7 ply・450 nodes。上限で証明が得られなかったことを安全の根拠にしない。受けの別解は最大8件を掲載し、再挑戦で未掲載点を選んだ場合も個別に調べる。掲載8件は全正解の列挙ではない。
